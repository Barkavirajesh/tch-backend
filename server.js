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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------- BASE URL ----------------
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// ---------------- SENDGRID ----------------
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const senderEmail = process.env.EMAIL_USER; // Verified sender
const doctorEmail = "tch231017@gmail.com";

// ---------------- SUPABASE ----------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------------- CONSTANTS ----------------
const JITSI_PREFIX = "sidhahealth";

// ---------------- HELPERS ----------------
async function sendEmail(to, subject, html) {
  try {
    await sgMail.send({
      to,
      from: senderEmail,
      subject,
      html,
      text: html.replace(/<[^>]+>/g, ""),
    });
    console.log(`✅ Email sent to ${to}`);
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}`);
    console.error(err.response?.body || err);
  }
}

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
    if (!email || !consultType)
      return res.status(400).json({ error: "Email and consult type required" });

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

    // ✅ Links for doctor to confirm or decline
    const confirmLink = `${BASE_URL}/doctor-action/${id}/confirm`;
    const declineLink = `${BASE_URL}/doctor-action/${id}/decline`;

    const doctorHtml = `
      <h2>🩺 New Appointment Request</h2>
      <p><b>Patient:</b> ${name}</p>
      <p><b>Email:</b> ${email}</p>
      <p><b>Date:</b> ${date}</p>
      <p><b>Time:</b> ${time}</p>
      <p><b>Type:</b> ${consultType}</p>
      <br>
      <a href="${confirmLink}" style="background:green;color:white;padding:10px;border-radius:5px;text-decoration:none;">Confirm Appointment</a>
      &nbsp;&nbsp;
      <a href="${declineLink}" style="background:red;color:white;padding:10px;border-radius:5px;text-decoration:none;">Decline Appointment</a>
    `;

    await sendEmail(doctorEmail, "New Appointment Request", doctorHtml);

    res.json({ message: "✅ Appointment request sent!", appointmentId: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 2️⃣ Doctor Confirm / Decline Link
app.get("/doctor-action/:id/:action", async (req, res) => {
  try {
    const { id, action } = req.params;
    const appointment = await getAppointment(id);
    if (!appointment) return res.status(404).send("❌ Appointment not found.");

    if (appointment.confirmed) return res.send("✅ Appointment already confirmed.");
    if (appointment.declined) return res.send("❌ Appointment already declined.");

    if (action === "confirm") {
      const isOnline = appointment.consult_type.toLowerCase() === "online";
      const fee = 500;
      const updates = {
        confirmed: true,
        final_time: appointment.time,
        amount: fee,
        payment_done: !isOnline,
      };

      let jitsiLink = null;
      if (isOnline) {
        const room = `${JITSI_PREFIX}-${Math.random().toString(36).slice(2, 10)}`;
        jitsiLink = `https://meet.jit.si/${room}`;
        updates.jitsi_room = room;
        updates.video_link = jitsiLink;
        updates.payment_link = `${BASE_URL}/payment/${appointment.id}`;
      }

      await updateAppointment(appointment.id, updates);

      // Patient Email
      const patientHtml = `
        <h2>Your Appointment is Confirmed</h2>
        <p><b>Date:</b> ${appointment.date}</p>
        <p><b>Time:</b> ${appointment.time}</p>
        ${isOnline ? `<p><b>Video Link:</b> <a href="${jitsiLink}">${jitsiLink}</a></p>` : ""}
        <p><b>Fee:</b> ₹${fee}</p>
        ${isOnline ? `<a href="${updates.payment_link}">Pay Now</a>` : ""}
      `;
      await sendEmail(appointment.email, "Appointment Confirmed", patientHtml);

      // Doctor Email (with video link if online)
      const doctorHtml = `
        <h2>Appointment Confirmed</h2>
        <p><b>Patient:</b> ${appointment.name}</p>
        <p><b>Date:</b> ${appointment.date}</p>
        <p><b>Time:</b> ${appointment.time}</p>
        <p><b>Type:</b> ${appointment.consult_type}</p>
        ${isOnline ? `<p><b>Video Link:</b> <a href="${jitsiLink}">${jitsiLink}</a></p>` : ""}
      `;
      await sendEmail(doctorEmail, "Appointment Confirmed - Consultation Link", doctorHtml);

      res.send("✅ Appointment confirmed and emails sent.");
    } else if (action === "decline") {
      await updateAppointment(appointment.id, { declined: true, decline_reason: "Declined by doctor" });
      const declineHtml = `<h3>Your appointment was declined</h3><p>Reason: Declined by doctor</p>`;
      await sendEmail(appointment.email, "Appointment Declined", declineHtml);
      res.send("❌ Appointment declined and patient notified.");
    } else {
      res.status(400).send("❌ Invalid action.");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error");
  }
});

// 3️⃣ Payment Page
app.get("/payment/:id", async (req, res) => {
  const appointment = await getAppointment(req.params.id);
  if (!appointment) return res.status(404).send("Appointment not found");

  const upi = process.env.UPI_ID;
  const amount = appointment.amount;
  const upiLink = `upi://pay?pa=${upi}&pn=SidhaHealth&am=${amount}&cu=INR`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiLink)}`;

  res.send(`
    <h2>Pay ₹${amount}</h2>
    <img src="${qr}" />
    <br>
    <a href="${upiLink}">Pay Using UPI</a>
  `);
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on ${BASE_URL}`));
