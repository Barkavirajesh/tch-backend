// migrate-to-supabase.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing Supabase config in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const filePath = path.join(__dirname, "appointments.json"); // adjust if different
if (!fs.existsSync(filePath)) {
  console.error("appointments.json not found at", filePath);
  process.exit(1);
}

const raw = fs.readFileSync(filePath, "utf8");
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  console.error("Invalid JSON:", e);
  process.exit(1);
}

const appointments = Array.isArray(parsed.appointments) ? parsed.appointments : Object.values(parsed.appointments || {});

(async () => {
  for (const a of appointments) {
    // normalize fields to match DB
    const row = {
      id: a.id,
      name: a.name,
      email: a.email,
      phone: a.phone || a.number || null,
      date: a.date || null,
      time: a.time || null,
      consult_type: a.consultType || a.consult_type || null,
      confirmed: !!a.confirmed,
      declined: !!a.declined,
      final_time: a.finalTime || null,
      payment_done: !!a.paymentDone,
      jitsi_room: a.jitsiRoom || null,
      video_link: a.videoLink || null,
      payment_link: a.paymentLink || null,
      amount: a.amount || null,
      decline_reason: a.declineReason || a.decline_reason || null
    };

    const { error } = await supabase.from("appointments").upsert([row], { onConflict: "id" });
    if (error) console.error("Insert error for", a.id, error);
    else console.log("Migrated", a.id);
  }
  console.log("Done migration.");
  process.exit(0);
})();
