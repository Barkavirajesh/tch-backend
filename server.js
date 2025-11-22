const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------ Config ------------------
const JITSI_PREFIX = "sidhahealth";
const doctorEmail = "tch231017@gmail.com"; // Doctor's email
// Doctor's email
const appointments = new Map();

// ------------------ Nodemailer Setup ------------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.error("Nodemailer config error:", error);
  } else {
    console.log("Nodemailer ready to send emails");
  }
});

// ------------------ STEP 1: Book Appointment ------------------
app.post("/book-appointment", async (req, res) => {
  const { name, email, phone, date, time, consultType, age, amount } = req.body;
  if (!email || !consultType)
    return res.status(400).json({ error: "Email and consult type are required" });

  const id = uuidv4();
  appointments.set(id, { 
  id, 
  name, 
  email, 
  phone,

  date, 
  time, 
  consultType, 
  confirmed: false, 
  declined: false 
});


  try {
    const confirmLink = `http://localhost:${process.env.PORT || 5000}/confirm-appointment/${id}`;
    const declineLink = `http://localhost:${process.env.PORT || 5000}/decline-appointment/${id}`;
    const doctorHtml = `
      <div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;background:#f7fafc;padding:28px 30px 20px 30px;border-radius:12px;border:1px solid #eee;">
        <h2 style="color:#16aa53;text-align:center;margin-bottom:18px;">🩺 New Appointment Request</h2>
        <div style="margin-bottom:18px;padding:14px;background:#eef9f1;border-radius:6px;">
          <b>Patient:</b> ${name}<br>
          <b>Email:</b> ${email}<br>
          <b>Date:</b> ${date}<br>
          <b>Slot:</b> ${time}<br>
             
          <b>Type:</b> ${consultType}
        </div>
        <div style="text-align:center;">
          <a href="${confirmLink}" style="background:#16aa53;color:white;padding:12px 30px;font-size:18px;text-decoration:none;border-radius:8px;display:inline-block;margin-right:14px;">Confirm</a>
          <a href="${declineLink}" style="background:#c00;color:white;padding:12px 30px;font-size:18px;text-decoration:none;border-radius:8px;display:inline-block;">Decline</a>
        </div>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: doctorEmail,
      subject: "New Appointment Request",
      html: doctorHtml,
    });

    res.json({ message: "Appointment request sent.", appointmentId: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send email." });
  }
});

// ------------------ STEP 2: Doctor Confirmation Page ------------------
app.get("/confirm-appointment/:id", (req, res) => {
  const appointment = appointments.get(req.params.id);
  if (!appointment)
    return res.status(404).send('<div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;padding:40px;text-align:center;"><h3 style="color:#c00;font-weight:600;">❌ Appointment not found.</h3></div>');

  if (appointment.confirmed)
    return res.send('<div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;padding:40px;text-align:center;"><h3 style="color:#16aa53;font-weight:600;">✅ Already confirmed.</h3></div>');

  if (appointment.declined)
    return res.send('<div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;padding:40px;text-align:center;"><h3 style="color:#c00;font-weight:600;">❌ Appointment already declined.</h3></div>');

  res.send(`
    <html>
      <head>
        <title>Confirm or Decline Appointment</title>
        <link href="https://fonts.googleapis.com/css?family=Roboto:400,700&display=swap" rel="stylesheet">
      </head>
      <body style="font-family:Roboto,Arial,sans-serif;background:#f7fafc;">
        <div style="max-width:540px;margin:54px auto 0 auto;background:#fff;border-radius:14px;box-shadow:0 2px 10px #eee;padding:35px 32px;">
          <h2 style="color:#16aa53;text-align:center;margin-bottom:22px;">Confirm or Decline Appointment</h2>
          <div style="margin-bottom:18px;padding:14px;background:#eef9f1;border-radius:6px;">
            <b>Patient:</b> ${appointment.name}<br>
            <b>Email:</b> ${appointment.email}<br>
            <b>Date:</b> ${appointment.date}<br>
            <b>Slot:</b> ${appointment.time}<br>
          

            <b>Type:</b> ${appointment.consultType}
          </div>
          <form action="/confirm-appointment/${appointment.id}" method="POST" style="margin-bottom:16px;">
            <label style="font-weight:500;">Final Consultation Time:</label><br>
            <input type="text" name="finalTime" required style="width:100%;padding:10px 8px;margin:10px 0 18px 0;border:1px solid #ccc;border-radius:6px;"><br>
            <button type="submit" style="background:#16aa53;color:white;padding:12px 22px;border:none;border-radius:8px;font-size:17px;font-weight:500;">Confirm</button>
          </form>
          <form action="/decline-appointment/${appointment.id}" method="POST">
            <label style="font-weight:500;color:#c00;">Reason for Decline (optional):</label><br>
            <input type="text" name="declineReason" placeholder="Type reason here..." style="width:100%;padding:10px 8px;margin:10px 0 18px 0;border:1px solid #ccc;border-radius:6px;"><br>
            <button type="submit" style="background:#c00;color:white;padding:12px 22px;border:none;border-radius:8px;font-size:17px;font-weight:500;">Decline</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

// Confirm POST
app.post("/confirm-appointment/:id", async (req, res) => {
  const appointment = appointments.get(req.params.id);
  if (!appointment) return res.status(404).send("Appointment not found.");
  if (appointment.declined)
    return res.send('<div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;padding:44px;text-align:center;"><h3 style="color:#c00;font-weight:600;">❌ Appointment already declined.</h3></div>');

  const { finalTime } = req.body;
  const isOnline = appointment.consultType.toLowerCase() === "online";
  const consultationFee = 500;

  appointment.confirmed = true;
  appointment.finalTime = finalTime;
  appointment.paymentDone = false;

  if (isOnline) {
    appointment.jitsiRoom = `${JITSI_PREFIX}-${Math.random().toString(36).substring(2, 10)}`;
    appointment.videoLink = `https://meet.jit.si/${appointment.jitsiRoom}`;
    appointment.paymentLink = `http://localhost:${process.env.PORT || 5000}/payment/${appointment.id}`;
    appointment.amount = consultationFee;
  } else {
    appointment.amount = consultationFee;
  }
  appointments.set(appointment.id, appointment);

  // Patient confirmation email
  const patientHtml = `
    <div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;background:#fff;padding:32px 32px 22px 32px;border-radius:14px;border:1px solid #eee;">
      <h2 style="color:#16aa53;text-align:center;margin-bottom:22px;">✅ Appointment Confirmed!</h2>
      <div style="margin-bottom:18px;padding:14px;background:#eef9f1;border-radius:6px;">
        Hello ${appointment.name}, your appointment is confirmed.<br>
        <b>Date:</b> ${appointment.date}<br>
        <b>Time:</b> ${finalTime}<br>
        <b>Fee:</b> ₹${consultationFee}
      </div>

      ${
        isOnline
          ? `
            <div style="text-align:center;margin-bottom:12px;">
              <a href="${appointment.paymentLink}" style="background:#16aa53;color:white;padding:12px 30px;text-decoration:none;font-size:18px;border-radius:8px;">💳 Pay Now</a>
            </div>
            <p style="margin-top:8px;color:#666;text-align:center;">After payment, you will receive your video consultation link.</p>
          `
          : `
            <p style="margin-top:8px;color:#666;text-align:center;">Please visit the clinic at your scheduled time.</p>
          `
      }
    </div>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to:    appointment.email,
    subject: "Appointment Confirmed",
    html: patientHtml,
  });

  // Doctor confirmation/consultation link email
  let docHtml = `
    <div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;background:#fff;padding:32px 32px 22px 32px;border-radius:14px;border:1px solid #eee;">
      <h2 style="color:#16aa53;text-align:center;margin-bottom:22px;">✅ Appointment Confirmed</h2>
      <div style="margin-bottom:18px;padding:14px;background:#eef9f1;border-radius:6px;">
        <b>Patient:</b> ${appointment.name}<br>
        <b>Email:</b> ${appointment.email}<br>
        <b>Date:</b> ${appointment.date}<br>
        <b>Time:</b> ${finalTime}<br>
      
        <b>Type:</b> ${appointment.consultType}
        

      </div>`;

  if (isOnline && appointment.videoLink) {
    docHtml += `
      <div style="margin-bottom:18px;text-align:center;padding:10px 0 0 0;">
        <a href="${appointment.videoLink}" style="background:#16aa53;color:white;padding:12px 28px;text-decoration:none;font-size:18px;border-radius:8px;display:inline-block;">
          🔗 Doctor Consultation Link
        </a>
        <div style="margin-top:10px;color:#666;text-align:center;font-size:15px;">
          Click above to join at the scheduled time.
        </div>
      </div>
    `;
  }
  docHtml += `</div>`;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: doctorEmail,
    subject: "Appointment Confirmed - Patient Details & Consultation Link",
    html: docHtml,
  });

  res.send(`
    <div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;padding:44px;text-align:center;">
      <h3 style="color:#16aa53;font-weight:600;">✅ Appointment confirmed and patient notified!</h3>
    </div>
  `);
});

// Decline POST
app.post("/decline-appointment/:id", async (req, res) => {
  const appointment = appointments.get(req.params.id);
  if (!appointment) return res.status(404).send("Appointment not found.");
  if (appointment.confirmed)
    return res.send('<div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;padding:44px;text-align:center;"><h3 style="color:#16aa53;font-weight:600;">✅ Appointment already confirmed.</h3></div>');

  appointment.declined = true;
  appointment.declineReason = req.body.declineReason || "No reason provided.";

  // Patient decline email
  const declineHtml = `
    <div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;background:#fff;padding:32px 32px 22px 32px;border-radius:14px;border:1px solid #eee;">
      <h2 style="color:#c00;text-align:center;margin-bottom:22px;">❌ Appointment Declined</h2>
      <div style="margin-bottom:18px;padding:14px;background:#fbeaea;border-radius:6px;">
        Hello ${appointment.name}, your appointment request was declined.<br>
        <b>Date:</b> ${appointment.date}<br>
        <b>Time:</b> ${appointment.time}<br>
      </div>
      <p style="margin:0 6px 12px;color:#444;">Reason: ${appointment.declineReason}</p>
      <p style="color:#989898;text-align:center;">You may try booking another slot.</p>
    </div>
  `;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: appointment.email,
    subject: "Appointment Declined",
    html: declineHtml,
  });

  res.send(`
    <div style="font-family:Roboto,Arial,sans-serif;max-width:540px;margin:auto;padding:44px;text-align:center;">
      <h3 style="color:#c00;font-weight:600;">❌ Appointment declined and patient notified!</h3>
    </div>
  `);
});

// ------------------ STEP 4: Payment Page ------------------
app.get("/payment/:id", (req, res) => {
  const appointment = appointments.get(req.params.id);
  if (!appointment) return res.status(404).send("Appointment not found");

  const upiId = process.env.UPI_ID || "yourupiid@oksbi";
  const amount = appointment.amount;
  const upiLink = `upi://pay?pa=${upiId}&pn=SidhaHealth&am=${amount}&cu=INR&tn=Consultation`;
  const qrImage = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(upiLink)}&size=270x270`;

  res.send(`
    <html>
      <head>
        <title>Pay Consultation Fee</title>
        <link href="https://fonts.googleapis.com/css?family=Roboto:400,700&display=swap" rel="stylesheet">
      </head>
      <body style="font-family:Roboto,Arial,sans-serif;background:#f7fafc;">
        <div style="max-width:500px;margin:54px auto 0 auto;background:#fff;border-radius:16px;box-shadow:0 2px 11px #eee;padding:38px 32px;">

          <!-- Payment Instruction Message -->
          <div style="border:1px solid #e1ffc6;padding:18px 22px;border-radius:10px;background:#f5fff0;margin-bottom:15px;">
            <p style="margin-bottom:12px;color:#009a35;font-weight:500;font-size:1.1em;">Your appointment is confirmed.</p>
            <p style="color:#a16600;font-size:1.06em;"><strong>Important:</strong> Please do <strong>not make the payment early</strong>.<br>
            Make the payment <strong>only just before you join the online consultation.</strong></p>
            <p style="margin:12px 0;">You can pay using the UPI ID below:</p>
            <p style="font-size:1.21em;"><strong>${upiId}</strong></p>
            <p style="margin-top:12px;">Once payment is completed, you can proceed with your consultation.</p>
          </div>

          <h2 style="color:#16aa53;text-align:center;margin-bottom:22px;">💳 Pay ₹${amount} for Your Consultation</h2>
          <p style="text-align:center;color:#444;">Scan this QR code to pay to <b>${upiId}</b></p>
          <div style="text-align:center;margin-bottom:10px;">
            <img src="${qrImage}" alt="UPI QR" style="margin-bottom:8px;border-radius:10px;">
          </div>
          <div style="text-align:center;margin-bottom:18px;">
            <a id="upi-link" href="${upiLink}" style="background:#16aa53;color:white;padding:11px 26px;text-decoration:none;font-size:17px;border-radius:7px;display:inline-block;">Open UPI App</a>
          </div>
          <p id="wait-text" style="color:#555;text-align:center;">Please complete your payment in your UPI app.</p>
          <div style="text-align:center;">
            <button id="paid-btn" style="display:none;padding:11px 21px;background:#16aa53;color:white;border:none;border-radius:7px;font-size:17px;">✅ I’ve Paid</button>
          </div>
        </div>
        <script>
          window.paymentPageLoadTime = Date.now();
          const paidBtn = document.getElementById("paid-btn");
          const waitText = document.getElementById("wait-text");
          function showPaidButton() {
            waitText.innerText = "If your payment is complete, click below:";
            paidBtn.style.display = "inline-block";
          }
          setTimeout(showPaidButton, 120000);
          document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
              if (window.paymentPageLoadTime && (Date.now() - window.paymentPageLoadTime) >= 120000) {
                showPaidButton();
              }
            }
          });
          paidBtn.addEventListener("click", () => {
            fetch("/verify-payment/${appointment.id}", { method: "POST" })
              .then(res => res.text())
              .then(html => document.body.innerHTML = html)
              .catch(() => alert("Error verifying payment"));
          });
        </script>
      </body>
    </html>
  `);
});

// ------------------ STEP 5: Verify Payment ------------------
app.post("/verify-payment/:id", (req, res) => {
  const appointment = appointments.get(req.params.id);
  if (!appointment) return res.status(404).send("Appointment not found");

  appointment.paymentDone = true;
  appointments.set(appointment.id, appointment);

  res.send(`
    <html>
      <head>
        <title>Payment Verified</title>
        <link href="https://fonts.googleapis.com/css?family=Roboto:400,700&display=swap" rel="stylesheet">
      </head>
      <body style="font-family:Roboto,Arial,sans-serif;background:#f7fafc;">
        <div style="max-width:500px;margin:54px auto 0 auto;background:#fff;border-radius:16px;box-shadow:0 2px 11px #eee;padding:42px 32px;text-align:center;">
          <h2 style="color:#16aa53;margin-bottom:14px;">✅ Payment Verified Successfully!</h2>
          <p style="font-size:1.1em;color:#444;">Thank you, <b>${appointment.name}</b>. Your payment has been received.</p>
          <div style="margin:24px auto 0 auto;padding:18px 0;border-top:1px solid #e1e1e1;">
            <p><b>Date:</b> ${appointment.date}</p>
            <p><b>Time:</b> ${appointment.finalTime}</p>
          </div>
          ${
            appointment.videoLink
              ? `<div style="margin:21px auto 0 auto;">
                  <p style="color:#444;">Your video consultation link is ready:</p>
                  <a href="${appointment.videoLink}" target="_blank"
                    style="display:inline-block;margin-top:14px;background:#16aa53;color:white;padding:12px 25px;text-decoration:none;border-radius:8px;font-size:18px;">
                    🔗 Join Consultation
                  </a>
                  <p style="margin-top:10px;color:#666;">Click above to start your online consultation.</p>
                </div>`
              : `<p style="margin-top:14px;">This is an in-person appointment. Please visit the clinic at your scheduled time.</p>`
          }
        </div>
      </body>
    </html>
  `);
});

// ------------------ STEP 6: Consultation Access ------------------
app.get("/consultation/:id", (req, res) => {
  const appointment = appointments.get(req.params.id);
  if (!appointment) return res.status(404).send("Appointment not found");

  if (!appointment.paymentDone)
    return res.send('<div style="font-family:Roboto,Arial,sans-serif;max-width:500px;margin:54px auto 0 auto;background:#fff;border-radius:16px;box-shadow:0 2px 11px #eee;padding:40px 32px;text-align:center;"><h3>⚠️ Please complete payment first.</h3></div>');

  if (appointment.videoLink) return res.redirect(appointment.videoLink);

  res.send(`
    <html>
      <head>
        <title>Offline Consultation Confirmed</title>
        <link href="https://fonts.googleapis.com/css?family=Roboto:400,700&display=swap" rel="stylesheet">
      </head>
      <body style="font-family:Roboto,Arial,sans-serif;background:#f7fafc;">
        <div style="max-width:480px;margin:54px auto 0 auto;background:#fff;border-radius:14px;box-shadow:0 2px 10px #eee;padding:30px 26px;">
          <h3 style="color:#16aa53;text-align:center;">✅ Your offline consultation is confirmed.</h3>
          <div style="margin-top:18px;padding:14px;background:#eef9f1;border-radius:7px;">
            <b>Date:</b> ${appointment.date}<br>
            <b>Time:</b> ${appointment.finalTime}
          </div>
          <p style="margin-top:12px;color:#666;text-align:center;">Please visit the clinic at your scheduled time.</p>
        </div>
      </body>
    </html>
  `);
});

app.use(express.static(path.join(__dirname, "../frontend/build")));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/build/index.html"));
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`➡️ Open in browser: http://localhost:${PORT}`);
});     