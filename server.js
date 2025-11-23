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

const BASE_URL = process.env.BACKEND_URL || "https://traditional-care-hospital.onrender.com";

// ---------------- CORS ----------------
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

// ---------------- EMAIL ----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});
const doctorEmail = "tch231017@gmail.com";
const JITSI_PREFIX = "sidhahealth";

// ---------------- SUPABASE ----------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase variables");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------- HELPERS ----------------
async function saveAppointment(obj) {
  const { data, error } = await supabase
    .from("appointments")
    .insert([obj])
    .select();
  if (error) throw error;
  return data[0];
}

async function updateAppointment(id, updates) {
  const { data, error } = await supabase
    .from("appointments")
    .update(updates)
    .eq("id", id) // exact UUID match
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}
async function getAppointment(id) {
  try {
    if (!id || typeof id !== "string") return null;

    console.log("Fetching appointment with ID:", id);

    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("id", id) // DO NOT lowercase!
      .maybeSingle();

    if (error) {
      console.error("Supabase select error:", error.message);
      return null;
    }

    if (!data) {
      console.log(`❌ Appointment with ID ${id} not found`);
      return null;
    }

    console.log("Fetched appointment:", data);
    return data;
  } catch (err) {
    console.error("Error in getAppointment:", err);
    return null;
  }
}


// ---------------- ROUTES ----------------

// 1️⃣ Book Appointment
app.post("/book-appointment", async (req, res) => {
  try {
    const { name, email, number, date, time, consultType } = req.body;
    if (!name || !email || !number)
      return res.status(400).json({ error: "Missing required fields" });

    const id = uuidv4();
    const appointment = {
      id,
      name,
      email,
      phone: number,
      date,
      time,
      consult_type: consultType,
      confirmed: false,
      declined: false,
    };

    await saveAppointment(appointment);

    const confirmLink = `${BASE_URL}/confirm-appointment/${id}`;
    const declineLink = `${BASE_URL}/decline-appointment/${id}`;

    const doctorHtml = `
      <h2>New Appointment</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Time:</strong> ${time}</p>
      <p><strong>Type:</strong> ${consultType}</p>
      <br>
      <a href="${confirmLink}" style="color:green">Confirm</a> |
      <a href="${declineLink}" style="color:red">Decline</a>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: doctorEmail,
      subject: "New Appointment Request",
      html: doctorHtml,
    });

    res.json({ message: "Request sent successfully", appointmentId: id });
  } catch (err) {
    console.error("Error in /book-appointment:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2️⃣ Confirm Appointment Page
app.get("/confirm-appointment/:id", async (req, res) => {
  try {
    const appointment = await getAppointment(req.params.id);
    if (!appointment)
      return res.status(404).send("<h1 style='color:red;'>❌ Appointment not found.</h1>");

    if (appointment.confirmed)
      return res.send("<h2>✅ This appointment is already confirmed.</h2>");
    if (appointment.declined)
      return res.send("<h2>❌ This appointment was already declined.</h2>");

    res.send(`
      <h2>Confirm Appointment</h2>
      <p><strong>Name:</strong> ${appointment.name}</p>
      <p><strong>Email:</strong> ${appointment.email}</p>
      <p><strong>Date:</strong> ${appointment.date}</p>
      <p><strong>Time:</strong> ${appointment.time}</p>
      <p><strong>Type:</strong> ${appointment.consult_type}</p>

      <form action="${BASE_URL}/confirm-appointment/${appointment.id}" method="POST">
        <label>Final Time:</label>
        <input name="finalTime" required />
        <button type="submit">Confirm</button>
      </form>

      <form action="${BASE_URL}/decline-appointment/${appointment.id}" method="POST">
        <label>Decline Reason:</label>
        <input name="declineReason" />
        <button type="submit">Decline</button>
      </form>
    `);
  } catch (err) {
    console.error("Error in GET /confirm-appointment/:id", err);
    res.status(500).send("Internal server error");
  }
});

// 3️⃣ Confirm Appointment POST
app.post("/confirm-appointment/:id", async (req, res) => {
  try {
    const appointment = await getAppointment(req.params.id);
    if (!appointment) return res.send("❌ Appointment not found");

    const finalTime = req.body.finalTime;
    const isOnline = appointment.consult_type?.toLowerCase() === "online";
    const amount = 500;

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

    await updateAppointment(appointment.id, updates);

    let html = `<h2>Appointment Confirmed</h2>
      <p>Date: ${appointment.date}</p>
      <p>Time: ${finalTime}</p>
      <p>Fee: ₹${amount}</p>`;
    if (isOnline) html += `<p><a href="${updates.payment_link}">Pay Now</a></p>`;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: appointment.email,
      subject: "Appointment Confirmed",
      html,
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: doctorEmail,
      subject: "Appointment Confirmed",
      html: `<h3>Appointment with ${appointment.name} confirmed at ${finalTime}</h3>`,
    });

    res.send("✅ Confirmed successfully!");
  } catch (err) {
    console.error("Error in POST /confirm-appointment/:id", err);
    res.status(500).send("Internal server error");
  }
});

// 4️⃣ Decline Appointment
app.post("/decline-appointment/:id", async (req, res) => {
  try {
    const appointment = await getAppointment(req.params.id);
    if (!appointment) return res.send("❌ Appointment not found");

    const reason = req.body.declineReason || "No reason given";
    await updateAppointment(appointment.id, { declined: true, decline_reason: reason });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: appointment.email,
      subject: "Appointment Declined",
      html: `<h3>Your appointment was declined</h3><p>${reason}</p>`,
    });

    res.send("❌ Appointment declined.");
  } catch (err) {
    console.error("Error in POST /decline-appointment/:id", err);
    res.status(500).send("Internal server error");
  }
});

// 5️⃣ Payment Page
app.get("/payment/:id", async (req, res) => {
  try {
    const appointment = await getAppointment(req.params.id);
    if (!appointment) return res.send("❌ Appointment not found");

    const upi = process.env.UPI_ID;
    const amount = appointment.amount;
    const upiLink = `upi://pay?pa=${upi}&pn=SidhaHealth&am=${amount}&cu=INR`;
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiLink)}`;

    res.send(`
      <h2>Pay ₹${amount}</h2>
      <img src="${qr}" />
      <br><br>
      <a href="${upiLink}">Pay Using UPI</a>
    `);
  } catch (err) {
    console.error("Error in GET /payment/:id", err);
    res.status(500).send("Internal server error");
  }
});

// 6️⃣ Consultation Link
app.get("/consultation/:id", async (req, res) => {
  try {
    const appointment = await getAppointment(req.params.id);
    if (!appointment) return res.send("❌ Appointment not found");
    if (!appointment.payment_done) return res.send("⚠ Payment Pending");

    if (appointment.video_link)
      return res.send(`<h2>Join Online Consultation</h2><a href="${appointment.video_link}">Join Now</a>`);

    res.send(`<h2>Offline Consultation</h2>
      <p>Date: ${appointment.date}</p>
      <p>Time: ${appointment.final_time}</p>`);
  } catch (err) {
    console.error("Error in GET /consultation/:id", err);
    res.status(500).send("Internal server error");
  }
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}, open: ${BASE_URL}`)
);
