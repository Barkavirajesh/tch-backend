// server.js
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@supabase/supabase-js";
import sgMail from "@sendgrid/mail";

// ---------------- ENV SETUP ----------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

// ---------------- EXPRESS SETUP ----------------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

// ---------------- BASE URL ----------------
const BASE_URL = process.env.BASE_URL || "https://tch-backend-1.onrender.com";

// ---------------- SENDGRID SETUP ----------------
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const senderEmail = process.env.EMAIL_USER;      // Verified SendGrid sender
const doctorEmail = "tch231017@gmail.com";       // Doctor's email

async function sendEmail(to, subject, html) {
  try {
    await sgMail.send({ to, from: senderEmail, subject, html });
    console.log("✅ Email sent to", to);
  } catch (err) {
    console.error("❌ Failed to send email to", to, err);
  }
}

// ---------------- JITSI PREFIX ----------------
const JITSI_PREFIX = "sidhahealth";

// ---------------- SUPABASE SETUP ----------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------------- HELPERS ----------------
async function saveAppointment(obj) {
  const { data, error } = await supabase.from("appointments").insert([obj]).select();
  if (error) throw error;
  return data[0];
}

async function updateAppointment(id, updates) {
  const { data, error } = await supabase
    .from("appointments")
    .update(updates)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getAppointment(id) {
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

// ---------------- ROUTES ----------------

// 1️⃣ Book Appointment
app.post("/book-appointment", async (req, res) => {
  try {
    const { name, email, number, date, time, consultType } = req.body;

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
      <h2>New Appointment Request</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Date:</strong> ${date}</p>
      <p><strong>Time:</strong> ${time}</p>
      <p><strong>Type:</strong> ${consultType}</p>
      <br>
      <a href="${confirmLink}" style="color:white;background:green;padding:10px;border-radius:5px;text-decoration:none">Confirm</a>
      &nbsp;&nbsp;
      <a href="${declineLink}" style="color:white;background:red;padding:10px;border-radius:5px;text-decoration:none">Decline</a>
    `;

    await sendEmail(doctorEmail, "New Appointment Request", doctorHtml);

    res.json({ message: "✅ Appointment request sent!", appointmentId: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2️⃣ Confirm Appointment - PAGE
app.get("/confirm-appointment/:id", async (req, res) => {
  const appointment = await getAppointment(req.params.id);
  if (!appointment) return res.send("<h1>❌ Appointment not found.</h1>");
  if (appointment.confirmed) return res.send("<h2>Appointment Already Confirmed</h2>");
  if (appointment.declined) return res.send("<h2>Appointment Already Declined</h2>");

  res.send(`
    <h2>Finalize Appointment Time</h2>
    <form action="${BASE_URL}/confirm-appointment/${appointment.id}" method="POST">
      <label><strong>Enter Final Time:</strong></label><br>
      <input name="finalTime" required style="padding:8px;margin:10px"><br><br>
      <button type="submit" style="background:green;color:white;padding:10px 20px;border:none;border-radius:5px;">Confirm Appointment</button>
    </form>
    <br><br>
    <form action="${BASE_URL}/decline-appointment/${appointment.id}" method="POST">
      <label><strong>Decline Reason:</strong></label><br>
      <input name="declineReason" style="padding:8px;margin:10px"><br><br>
      <button type="submit" style="background:red;color:white;padding:10px 20px;border:none;border-radius:5px;">Decline Appointment</button>
    </form>
  `);
});

// 3️⃣ Confirm Appointment - SUBMIT
app.post("/confirm-appointment/:id", async (req, res) => {
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

  const patientHtml = `
    <h2>Your Appointment is Confirmed</h2>
    <p><strong>Date:</strong> ${appointment.date}</p>
    <p><strong>Time:</strong> ${finalTime}</p>
    <p><strong>Fee:</strong> ₹${amount}</p>
    ${isOnline ? `<a href="${updates.payment_link}">Pay Now</a>` : ""}
  `;
  await sendEmail(appointment.email, "Appointment Confirmed", patientHtml);

  res.send("<h2>✅ Appointment Confirmed Successfully!</h2>");
});

// 4️⃣ Decline Appointment
app.post("/decline-appointment/:id", async (req, res) => {
  const appointment = await getAppointment(req.params.id);
  if (!appointment) return res.send("❌ Appointment not found");

  const reason = req.body.declineReason || "No reason provided";
  await updateAppointment(appointment.id, { declined: true, decline_reason: reason });

  const declineHtml = `<h3>Your appointment was declined</h3><p>${reason}</p>`;
  await sendEmail(appointment.email, "Appointment Declined", declineHtml);

  res.send("<h2>❌ Appointment Declined</h2>");
});

// 5️⃣ Payment Page
app.get("/payment/:id", async (req, res) => {
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
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🔥 Backend running on ${BASE_URL}`));
