// server.js
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@supabase/supabase-js";

// ---------------- ENV SETUP ----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BASE_URL = process.env.BACKEND_URL || "http://localhost:5000";

// ---------------- CORS ----------------
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

// ---------------- EMAIL ----------------
// Make sure EMAIL_USER and EMAIL_PASS are set in .env (Gmail app password recommended)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});
const doctorEmail = "tch231017@gmail.com";
const JITSI_PREFIX = "sidhahealth";

// ---------------- SUPABASE ----------------
// MUST use the SERVICE ROLE key on the server (do not expose it to the client)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase env variables: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// createClient v2 — service role usage on server
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }, // server-side, do not persist client session
});

// ---------------- HELPERS ----------------
async function saveAppointment(obj) {
  // Use upsert so confirm/decline can update existing row
  const { data, error } = await supabase
    .from("appointments")
    .upsert([obj], { onConflict: "id" });

  if (error) {
    console.error("❌ Supabase Upsert Error:", error);
    throw error;
  }
  return data;
}

async function getAppointment(id) {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    // return null so callers can show "Appointment not found"
    console.error("❌ Supabase Select Error:", error);
    return null;
  }
  return data;
}

// ---------------- ROUTES ----------------

// 1️⃣ Book Appointment
app.post("/book-appointment", async (req, res) => {
  try {
    const { name, email, number, date, time, consultType } = req.body;

    if (!name || !email || !number) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const id = uuidv4();
    const appointment = {
      id,
      name,
      email,
      phone: number,
      date,
      time,
      consult_type: consultType || "offline",
      confirmed: false,
      declined: false,
    };

    await saveAppointment(appointment);

    // links that doctor clicks to confirm or decline
    const confirmLink = `${BASE_URL}/confirm-appointment/${id}`;
    const declineLink = `${BASE_URL}/decline-appointment/${id}`;

    const doctorEmailHtml = `
      <h2>New Appointment</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Time:</strong> ${time}</p>
      <p><strong>Type:</strong> ${consultType}</p>
      <br/>
      <a href="${confirmLink}" style="color:green">Confirm Appointment</a> |
      <a href="${declineLink}" style="color:red">Decline Appointment</a>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: doctorEmail,
      subject: "New Appointment Request",
      html: doctorEmailHtml,
    });

    res.json({ message: "Appointment sent to doctor successfully", appointmentId: id });
  } catch (err) {
    console.error("❌ Error in /book-appointment:", err);
    // if it's a Supabase RLS error, surface it for debugging (remove in production)
    if (err && err.message) {
      return res.status(500).json({ error: "Internal server error", detail: err.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2️⃣ Confirm Appointment (GET form shown to doctor)
app.get("/confirm-appointment/:id", async (req, res) => {
  const appointment = await getAppointment(req.params.id);

  if (!appointment) {
    return res.status(404).send("<h1 style='color:red;'>❌ Appointment not found.</h1>");
  }

  if (appointment.confirmed) return res.send("<h2>✅ This appointment is already confirmed.</h2>");
  if (appointment.declined) return res.send("<h2>❌ This appointment has been declined.</h2>");

  // show a simple HTML form where doctor picks/enters final time
  res.send(`
    <h2>Confirm Appointment</h2>

    <p><strong>Patient:</strong> ${appointment.name}</p>
    <p><strong>Email:</strong> ${appointment.email}</p>
    <p><strong>Date:</strong> ${appointment.date}</p>
    <p><strong>Requested Time:</strong> ${appointment.time || 'N/A'}</p>
    <p><strong>Type:</strong> ${appointment.consult_type}</p>

    <form action="${BASE_URL}/confirm-appointment/${appointment.id}" method="POST">
      <label>Enter Final Time (doctor):</label><br/>
      <input name="finalTime" required placeholder="e.g., 10:30 AM"/><br/><br/>
      <label>Fee (optional):</label><br/>
      <input name="amount" placeholder="e.g., 500"/><br/><br/>
      <button type="submit">Confirm Appointment</button>
    </form>

    <hr/>

    <form action="${BASE_URL}/decline-appointment/${appointment.id}" method="POST">
      <label>Decline Reason (optional):</label><br/>
      <input name="declineReason" placeholder="Reason"/><br/><br/>
      <button type="submit" style="color:red;">Decline Appointment</button>
    </form>
  `);
});

// 3️⃣ Confirm Appointment (POST)
app.post("/confirm-appointment/:id", async (req, res) => {
  try {
    const appointment = await getAppointment(req.params.id);
    if (!appointment) return res.status(404).send("❌ Appointment not found");

    const finalTime = req.body.finalTime;
    const providedAmount = req.body.amount;
    const isOnline = (appointment.consult_type || "").toLowerCase() === "online";
    const amount = providedAmount ? Number(providedAmount) : 500;

    const updates = {
      confirmed: true,
      final_time: finalTime,
      amount,
      payment_done: false,
    };

    if (isOnline) {
      const room = `${JITSI_PREFIX}-${Math.random().toString(36).slice(2, 10)}`;
      updates.jitsi_room = room;
      updates.video_link = `https://meet.jit.si/${room}`;
      updates.payment_link = `${BASE_URL}/payment/${appointment.id}`;
    }

    // Save updated appointment (upsert by id)
    await saveAppointment({ ...appointment, ...updates });

    // notify patient by email
    const html = `
      <h2>Appointment Confirmed</h2>
      <p><strong>Date:</strong> ${appointment.date}</p>
      <p><strong>Time:</strong> ${finalTime}</p>
      <p><strong>Fee:</strong> ₹${amount}</p>
      ${isOnline ? `<p><a href="${updates.payment_link}">Pay Now</a></p>` : ''}
      ${isOnline && updates.video_link ? `<p>Video link (available after payment): will be emailed to you.</p>` : ''}
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: appointment.email,
      subject: "Your Appointment is Confirmed",
      html,
    });

    // also show a small success page to doctor
    res.send(`<h2>✅ Appointment Confirmed Successfully</h2><p>Patient notified: ${appointment.email}</p>`);
  } catch (err) {
    console.error("❌ Error in POST /confirm-appointment:", err);
    res.status(500).send("❌ Internal server error");
  }
});

// 4️⃣ Decline Appointment (POST)
app.post("/decline-appointment/:id", async (req, res) => {
  try {
    const appointment = await getAppointment(req.params.id);
    if (!appointment) return res.status(404).send("❌ Appointment not found");

    const reason = req.body.declineReason || "No reason provided";

    await saveAppointment({
      ...appointment,
      declined: true,
      decline_reason: reason,
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: appointment.email,
      subject: "Appointment Declined",
      html: `<h3>Your appointment was declined</h3><p>${reason}</p>`,
    });

    res.send("<h2>❌ Appointment Declined</h2><p>Patient has been notified.</p>");
  } catch (err) {
    console.error("❌ Error in /decline-appointment:", err);
    res.status(500).send("❌ Internal server error");
  }
});

// 5️⃣ Payment Page (simple UPI QR)
app.get("/payment/:id", async (req, res) => {
  const appointment = await getAppointment(req.params.id);
  if (!appointment) return res.status(404).send("❌ Appointment not found");

  const upi = process.env.UPI_ID || "";
  const amount = appointment.amount || 0;

  const upiLink = `upi://pay?pa=${encodeURIComponent(upi)}&pn=SidhaHealth&am=${encodeURIComponent(amount)}&cu=INR`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiLink)}`;

  res.send(`
    <h2>Pay ₹${amount}</h2>
    <img src="${qr}" alt="QR"/>
    <br/><br/>
    <a href="${upiLink}">Pay Using UPI</a>
  `);
});

// 6️⃣ Consultation Link
app.get("/consultation/:id", async (req, res) => {
  const appointment = await getAppointment(req.params.id);
  if (!appointment) return res.status(404).send("❌ Appointment not found");

  if (!appointment.payment_done) return res.send("⚠ Payment Pending");

  if (appointment.video_link) {
    return res.send(`<h2>Join Online Consultation</h2><a href="${appointment.video_link}">Join Now</a>`);
  }

  res.send(`
    <h2>Offline Consultation</h2>
    <p>Date: ${appointment.date}</p>
    <p>Time: ${appointment.final_time}</p>
  `);
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT} — open: ${BASE_URL}`));
