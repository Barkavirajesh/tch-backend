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
      return res.status(400).json({ error: "Email and appointment type required" });

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

    const confirmLink = `${BASE_URL}/doctor-action/${id}/confirm`;
    const declineLink = `${BASE_URL}/doctor-action/${id}/decline`;

    const doctorHtml = `
      <h2>🩺 New Appointment Request</h2>
      <p><b>Name:</b> ${name}</p>
      <p><b>Email:</b> ${email}</p>
      <p><b>Date:</b> ${date}</p>
      <p><b>Requested Time:</b> ${time}</p>
      <p><b>Consult Type:</b> ${consultType}</p>
      <br>
      <a href="${confirmLink}" style="background:green;color:white;padding:10px 15px;border-radius:5px;text-decoration:none;">Confirm Appointment</a>
      &nbsp;&nbsp;
      <a href="${declineLink}" style="background:red;color:white;padding:10px 15px;border-radius:5px;text-decoration:none;">Decline Appointment</a>
    `;

    await sendEmail(doctorEmail, "New Appointment Request", doctorHtml);

    res.json({ message: "Appointment request sent successfully", appointmentId: id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// 2️⃣ Manual Time Input (Doctor Confirm Page)
app.get("/doctor-action/:id/confirm", async (req, res) => {
  const { id } = req.params;
  const appointment = await getAppointment(id);
  if (!appointment) return res.status(404).send("❌ Appointment not found.");
  if (appointment.confirmed) return res.send("✅ Appointment already confirmed.");
  if (appointment.declined) return res.send("❌ Appointment already declined.");

  // Manual timing form
  res.send(`
    <h2>Enter Final Appointment Time</h2>
    <form method="POST" action="/doctor-set-time/${id}">
      <label>Final Time:</label><br>
      <input type="text" name="final_time" placeholder="e.g. 7:30 PM" required style="padding:10px;width:250px;font-size:16px;margin-top:10px;"/>
      <br><br>
      <button type="submit" style="padding:10px 20px;font-size:16px;background:green;color:white;border:none;border-radius:5px;">Confirm Appointment</button>
    </form>
  `);
});

// 3️⃣ Submit Final Time + Send Emails
app.post("/doctor-set-time/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { final_time } = req.body;

    const appointment = await getAppointment(id);
    if (!appointment) return res.status(404).send("❌ Appointment not found.");

    const isOnline = appointment.consult_type.toLowerCase() === "online";
    const fee = 500;

    let updates = {
      confirmed: true,
      final_time,
      amount: fee,
      payment_done: !isOnline,
    };

    let jitsiLink = null;

    if (isOnline) {
      const room = `${JITSI_PREFIX}-${Math.random().toString(36).slice(2, 10)}`;
      jitsiLink = `https://meet.jit.si/${room}`;
      updates.jitsi_room = room;
      updates.video_link = jitsiLink;
      updates.payment_link = `${BASE_URL}/payment/${id}`;
    }

    await updateAppointment(id, updates);

    // Patient Email (only Pay Now for online)
    const patientHtml = `
      <h2>Appointment Confirmed</h2>
      <p><b>Date:</b> ${appointment.date}</p>
      <p><b>Final Time:</b> ${final_time}</p>
      <p><b>Fee:</b> ₹${fee}</p>
      ${isOnline ? `<a href="${updates.payment_link}" style="padding:10px 20px;background:green;color:white;border-radius:5px;text-decoration:none;">Pay Now</a>` : ""}
    `;
    await sendEmail(appointment.email, "Your Appointment is Confirmed", patientHtml);

    // Doctor Email (with video link)
    const doctorHtml = `
      <h2>Appointment Confirmed</h2>
      <p><b>Patient:</b> ${appointment.name}</p>
      <p><b>Date:</b> ${appointment.date}</p>
      <p><b>Final Time:</b> ${final_time}</p>
      <p><b>Type:</b> ${appointment.consult_type}</p>
      ${isOnline ? `<p><b>Video Link:</b> <a href="${jitsiLink}">${jitsiLink}</a></p>` : ""}
    `;
    await sendEmail(doctorEmail, "Appointment Confirmed - Final Details", doctorHtml);

    res.send("✅ Appointment confirmed successfully. Emails sent.");

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
  }
});

// 4️⃣ Payment Page

// 4️⃣ Payment Page with 2-min delay for "I've Paid"
app.get("/payment/:id", async (req, res) => {
  const appointment = await getAppointment(req.params.id);
  if (!appointment) return res.status(404).send("Appointment not found");

  const upi = process.env.UPI_ID;
  const amount = appointment.amount;
  const upiLink = `upi://pay?pa=${upi}&pn=SidhaHealth&am=${amount}&cu=INR`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiLink)}`;

  res.send(`
    <h2>Pay ₹${amount} to confirm your appointment</h2>
    <img src="${qr}" />
    <br><br>
    <a href="${upiLink}" style="padding:10px 20px;background:green;color:white;border-radius:5px;text-decoration:none;">Pay Using UPI</a>
    <br><br>
    <form method="POST" action="/payment-done/${appointment.id}">
      <button id="paidBtn" type="submit" style="padding:10px 20px;background:blue;color:white;border-radius:5px; display:none;">I've Paid</button>
    </form>

    <script>
      // Show the "I've Paid" button after 2 minutes (120000 ms)
      setTimeout(() => {
        document.getElementById('paidBtn').style.display = 'inline-block';
      }, 120000);
    </script>
  `);
});

// 5️⃣ Payment Done → Show Video Link
app.post("/payment-done/:id", async (req, res) => {
  const appointment = await getAppointment(req.params.id);
  if (!appointment) return res.status(404).send("Appointment not found");

  await updateAppointment(appointment.id, { payment_done: true });

  if (appointment.consult_type.toLowerCase() === "online") {
    res.send(`
      <h2>Payment Confirmed ✅</h2>
      <p>Your video consultation is ready.</p>
      <a href="${appointment.video_link}" style="padding:10px 20px;background:green;color:white;border-radius:5px;text-decoration:none;">Join Now</a>
    `);
  } else {
    res.send("<h2>Payment Confirmed ✅</h2><p>Your appointment is confirmed.</p>");
  }
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on ${BASE_URL}`));
