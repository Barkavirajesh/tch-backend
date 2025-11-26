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

// Responsive email HTML template wrapper
function emailTemplate({ title, bodyHtml, actionLink, actionText }) {
  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
      body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
      body { margin:0; padding:0; width:100% !important; background:#f5f5f7; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#111; }
      table { border-collapse:collapse !important; }
      a { color:#2563eb; text-decoration:underline; }
      .card { max-width:480px; margin:20px auto; }
      @media screen and (max-width:600px){
        .card { padding:12px !important; }
        .content { padding:16px !important; }
        h1 { font-size:22px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f7;">
    <div class="card" style="background:#fff; border-radius:12px; box-shadow:0 5px 20px rgba(0,0,0,0.07); margin:30px auto; max-width:480px; padding:24px;">
      <div style="text-align:center;margin-bottom:20px;">
        <img src="https://sidhahealth.com/logo.png" alt="SidhaHealth Logo" style="height:44px; width:auto; border:none; background:transparent; display:inline-block;" />
      </div>
      <div class="content" style="padding:16px 10px;">
        <h1 style="font-size:24px;font-weight:700;color:#111;margin:0 0 12px;">${title}</h1>
        <div style="color:#363636;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </div>
        ${actionLink ? `
        <div style="text-align:center;margin:28px 0 0 0;">
          <a href="${actionLink}" style="display:inline-block; padding:12px 32px; border-radius:34px; background:#16a34a; color:#fff; font-weight:600; font-size:16px; text-decoration:none; margin:2px 7px;">${actionText}</a>
        </div>` : ""}
      </div>
      <div style="border-top:1px solid #ececec;margin:20px 0 0 0;padding-top:12px;font-size:13px;color:#8f8f8f;text-align:center;">
        SidhaHealth &middot; For help, contact <a href="mailto:support@sidhahealth.com" style="color:#2563eb;text-decoration:underline;">support@sidhahealth.com</a>
      </div>
    </div>
  </body>
</html>
  `;
}

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

    // Doctor Notification HTML
    const doctorHtml = emailTemplate({
      title: "🩺 New Appointment Request",
      bodyHtml: `
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Requested Time:</strong> ${time}</p>
        <p><strong>Consult Type:</strong> ${consultType}</p>
      `,
      actionLink: confirmLink,
      actionText: "Confirm Appointment"
    }) +
    emailTemplate({
      title: "Decline Appointment",
      bodyHtml: `
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Consult Type:</strong> ${consultType}</p>
      `,
      actionLink: declineLink,
      actionText: "Decline Appointment"
    });

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
    const patientHtml = emailTemplate({
      title: "Appointment Declined",
      bodyHtml: `<p>Your appointment on <strong>${appointment.date}</strong> has been declined by the doctor.</p>
                 <p><strong>Reason:</strong> ${reason}</p>`
    });
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

    const patientHtml = emailTemplate({
      title: "Appointment Confirmed",
      bodyHtml: `
        <p><strong>Date:</strong> ${appointment.date}</p>
        <p><strong>Final Time:</strong> ${final_time}</p>
        <p><strong>Fee:</strong> ₹${fee}</p>
        ${isOnline ? "<p style='margin-top:18px;'><strong>Online video consultation—please pay by clicking the button below.</strong></p>" : "<p style='margin-top:18px;'>Please pay at the clinic.</p>"}
      `,
      actionLink: isOnline ? updates.payment_link : null,
      actionText: isOnline ? "Pay Now" : null
    });
    await sendEmail(appointment.email, "Your Appointment is Confirmed", patientHtml);

    const doctorHtml = emailTemplate({
      title: "Appointment Confirmed - Final Details",
      bodyHtml: `
        <p><strong>Patient:</strong> ${appointment.name}</p>
        <p><strong>Date:</strong> ${appointment.date}</p>
        <p><strong>Final Time:</strong> ${final_time}</p>
        <p><strong>Type:</strong> ${appointment.consult_type}</p>
        ${isOnline ? `<p><strong>Video Link:</strong> <a href="${jitsiLink}">${jitsiLink}</a></p>` : ""}
      `,
      actionLink: isOnline ? jitsiLink : null,
      actionText: isOnline ? "Join Video" : null
    });
    await sendEmail(doctorEmail, "Appointment Confirmed - Final Details", doctorHtml);

    res.send("✅ Appointment confirmed successfully. Emails sent.");

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
  }
});

// 6️⃣ Payment Page (ENHANCED/CENTERED)
app.get("/payment/:id", async (req, res) => {
  const appointment = await getAppointment(req.params.id);
  if (!appointment) return res.status(404).send("Appointment not found");

  const upi = process.env.UPI_ID;
  const amount = appointment.amount;
  const upiLink = `upi://pay?pa=${upi}&pn=SidhaHealth&am=${amount}&cu=INR`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiLink)}`;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1.0" />
        <title>Pay to Confirm Appointment – SidhaHealth</title>
        <style>
          body {
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #f5f5f7;
            font-family: system-ui, sans-serif;
            margin: 0;
            padding: 0;
            color: #222;
          }
          .center-card {
            background: #fff;
            max-width: 410px;
            border-radius: 18px;
            box-shadow: 0 5px 24px rgba(0,0,0,0.09);
            padding: 32px 24px 24px 24px;
          }
          .logo { text-align: center; margin-bottom: 28px; }
          .logo img { height: 52px; }
          h2 { color: #0c4826; margin-top: 0; font-size: 23px; text-align:center; }
          .amount { font-size: 20px; font-weight: 700; color: #0c4826; text-align:center; margin-bottom:2px; }
          .qrbox { text-align:center; margin:24px 0 18px 0; }
          .upi-btn { display: inline-block; background: #16a34a; color: #fff; font-weight: 600; font-size: 17px; padding:11px 32px; border-radius:99px; text-decoration:none; margin-bottom:14px; }
          .waiting { font-size: 15px; text-align:center; color: #707070; margin:14px 0; }
          .paid-btn, .paid-btn:disabled { width:100%; max-width:260px; font-size:16px; font-weight:600; padding:12px; border-radius:8px; border:none; background:#2563eb; color:white; cursor:pointer; margin:auto; display:block; margin-top:14px; }
          .paid-btn:disabled { background: #b2c6f8; cursor: not-allowed; }
          .help { font-size: 13px; color: #7a7a7a; text-align:center; margin-top:20px; }
          @media screen and (max-width: 600px) {
            .center-card { padding:18px 8px 14px 8px; }
          }
        </style>
      </head>
      <body>
        <div class="center-card">
          <div class="logo">
            <img src="https://sidhahealth.com/logo.png" alt="SidhaHealth Logo"/>
          </div>
          <h2>Pay & Confirm Your Appointment</h2>
          <div class="amount">₹${amount}</div>
          <div class="qrbox">
            <img src="${qr}" height="180" width="180" alt="UPI QR Code" style="border:7px solid #ededed; border-radius:16px;">
          </div>
          <div style="text-align:center;">
            <a href="${upiLink}" class="upi-btn">Pay Instantly with UPI App</a>
          </div>
          <div class="waiting" id="statusText">
            Please complete your payment in your UPI app.<br>
            <span id="timerText"></span>
          </div>
          <form method="POST" action="/payment-done/${appointment.id}" style="text-align:center;">
            <button class="paid-btn" id="paidBtn" type="submit" disabled>I've Paid</button>
          </form>
          <div class="help">
            <strong>Need help?</strong> Email <a href="mailto:support@sidhahealth.com">support@sidhahealth.com</a>
            <br>
            <span style="color:#b91c1c;">Never share your PIN/OTP with anyone.</span>
          </div>
        </div>
        <script>
          let s = 120;
          const paidBtn = document.getElementById('paidBtn');
          const statusText = document.getElementById('statusText');
          const timerText = document.getElementById('timerText');
          function updateTimer() {
            if(s > 0) {
              timerText.innerHTML = 'Button enabled in '+s+'s';
              s--;
              setTimeout(updateTimer, 1000);
            } else {
              timerText.innerHTML = '';
              paidBtn.disabled = false;
              paidBtn.innerText = "I've Paid";
              statusText.innerHTML = 'After payment, click above to proceed.';
            }
          }
          paidBtn.innerText = "Please Wait...";
          updateTimer();
        </script>
      </body>
    </html>
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
