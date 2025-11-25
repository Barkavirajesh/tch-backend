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

    // Doctor Notification HTML, matching your image upload
    const doctorHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>New Appointment Request</title>
</head>
<body style="margin:0;padding:0;background:#f7fcfd;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:620px;margin:32px auto;background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.07);border:1px solid #eff3f4;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:26px;">
      <span style="font-size:28px;vertical-align:middle;">🩺</span>
      <span style="font-size:25px;font-weight:700;color:#22a86a;margin-left:9px;vertical-align:middle;">
        New Appointment Request
      </span>
    </div>
    <div style="background:#e8f8ee;border-radius:8px;padding:18px 15px;margin-bottom:30px;">
      <div style="font-size:17px;line-height:1.55;color:#133c27;">
        <span style="font-weight:bold;">Patient:</span> ${name}<br>
        <span style="font-weight:bold;">Email:</span> <a href="mailto:${email}" style="color:#2176b8;text-decoration:underline;">${email}</a><br>
        <span style="font-weight:bold;">Date:</span> ${date}<br>
        <span style="font-weight:bold;">Slot:</span> ${time}<br>
        <span style="font-weight:bold;">Type:</span> ${consultType}
      </div>
    </div>
    <div style="text-align:center;">
      <a href="${confirmLink}" style="display:inline-block;min-width:148px;padding:14px 0;border-radius:8px;background:#22a86a;color:#fff;font-size:20px;font-weight:600;text-decoration:none;margin:0 16px 4px 0;border:none;box-shadow:0 2px 8px rgba(34,168,106,0.13);">
        Confirm
      </a>
      <a href="${declineLink}" style="display:inline-block;min-width:148px;padding:14px 0;border-radius:8px;background:#d7111c;color:#fff;font-size:20px;font-weight:600;text-decoration:none;margin:0 0 4px 0;border:none;box-shadow:0 2px 8px rgba(215,17,28,0.11);">
        Decline
      </a>
    </div>
  </div>
</body>
</html>
    `;

    await sendEmail(doctorEmail, "New Appointment Request", doctorHtml);

    res.json({ message: "Appointment request sent successfully", appointmentId: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// 2️⃣ Doctor Confirm Page
app.get("/doctor-action/:id/confirm", async (req, res) => {
  const { id } = req.params;
  const appointment = await getAppointment(id);
  if (!appointment) return res.status(404).send("❌ Appointment not found.");
  if (appointment.confirmed) return res.send("✅ Appointment already confirmed.");
  if (appointment.declined) return res.send("❌ Appointment already declined.");

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

// 3️⃣ Doctor Decline Page → Ask for reason
app.get("/doctor-action/:id/decline", async (req, res) => {
  const { id } = req.params;
  const appointment = await getAppointment(id);
  if (!appointment) return res.status(404).send("❌ Appointment not found.");
  if (appointment.confirmed) return res.send("✅ Appointment already confirmed.");
  if (appointment.declined) return res.send("❌ Appointment already declined.");

  res.send(`
    <h2>Decline Appointment</h2>
    <form method="POST" action="/doctor-decline/${id}">
      <label>Reason for Decline:</label><br>
      <textarea name="reason" placeholder="Enter reason" required style="width:300px;height:100px;padding:8px;margin-top:8px;"></textarea>
      <br><br>
      <button type="submit" style="padding:10px 20px;background:red;color:white;border:none;border-radius:5px;">Decline Appointment</button>
    </form>
  `);
});

// 4️⃣ Submit Decline Reason
app.post("/doctor-decline/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const appointment = await getAppointment(id);
    if (!appointment) return res.status(404).send("❌ Appointment not found.");

    await updateAppointment(id, { declined: true, decline_reason: reason });

    // Notify patient
    const patientHtml = `
      <h2>Appointment Declined</h2>
      <p>Your appointment on <strong>${appointment.date}</strong> has been declined by the doctor.</p>
      <p><strong>Reason:</strong> ${reason}</p>
    `;
    await sendEmail(appointment.email, "Appointment Declined", patientHtml);

    res.send(`<h2>Appointment Declined ✅</h2><p>Reason submitted: ${reason}</p>`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
  }
});

// 5️⃣ Submit Final Time + Send Emails
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

    const patientHtml = `
      <h2>Appointment Confirmed</h2>
      <p><strong>Date:</strong> ${appointment.date}</p>
      <p><strong>Final Time:</strong> ${final_time}</p>
      <p><strong>Fee:</strong> ₹${fee}</p>
      ${isOnline ? "<p style='margin-top:18px;'><strong>Online video consultation—please pay by clicking the button below.</strong></p>" : "<p style='margin-top:18px;'>Please pay at the clinic.</p>"}
      ${isOnline ? `<a href="${updates.payment_link}" style="display:inline-block;margin-top:8px;padding:10px 24px;border-radius:7px;background:green;color:#fff;font-size:17px;text-decoration:none;font-weight:600;">Pay Now</a>` : ""}
    `;
    await sendEmail(appointment.email, "Your Appointment is Confirmed", patientHtml);

    const doctorHtml = `
      <h2>Appointment Confirmed</h2>
      <p><strong>Patient:</strong> ${appointment.name}</p>
      <p><strong>Date:</strong> ${appointment.date}</p>
      <p><strong>Final Time:</strong> ${final_time}</p>
      <p><strong>Type:</strong> ${appointment.consult_type}</p>
      ${isOnline ? `<p><strong>Video Link:</strong> <a href="${jitsiLink}">${jitsiLink}</a></p>` : ""}
    `;
    await sendEmail(doctorEmail, "Appointment Confirmed - Final Details", doctorHtml);

    res.send("✅ Appointment confirmed successfully. Emails sent.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
  }
});

// 6️⃣ Payment Page
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
      setTimeout(() => {
        document.getElementById('paidBtn').style.display = 'inline-block';
      }, 120000);
    </script>
  `);
});

// 7️⃣ Payment Done → Show Video Link
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
