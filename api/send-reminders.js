// GET /api/send-reminders
//
// Meant to be called every 5-10 minutes by a scheduler (Vercel Cron, or a
// free external pinger like cron-job.org) — see vercel.json / README notes.
// Each run scans bookings whose parking session is currently in progress and
// sends at most two emails per booking over its lifetime:
//   - "halfway" reminder, once the session is >= 50% elapsed
//   - "ending soon" reminder, once <= 15 minutes remain
// Both go to the renter, CC'd to the host, per the product requirement.
//
// Idempotent by design: each booking has confirmation_email_sent_at /
// reminder_halfway_sent_at / reminder_ending_sent_at columns (see
// supabase-migration-003-email-reminders.sql) that get set right after a
// send, so re-running this on overlapping schedules never double-sends.
//
// Auth: Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`
// when CRON_SECRET is set as an env var — this handler requires that same
// header, so it works identically whether triggered by Vercel Cron or any
// other scheduler configured with the same secret.

import { supabaseAdmin, getSessionWindow } from "./_lib.js";
import { sendEmail, halfwayReminderHtml, endingReminderHtml } from "./_email.js";

const ENDING_SOON_MINUTES = 15;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization || "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const now = new Date();

  // Any booking whose session could plausibly still be running or not yet
  // started: paid within the last 31 days (MAX_HOURS in
  // create-checkout-session.js). Filtering on paid_at (not the scheduled
  // start) is intentional — an advance booking's paid_at can be well before
  // its actual session, but it's still "recent" by payment date, so it
  // won't get excluded here. The real start/end math happens per-booking
  // below via getSessionWindow(), which is what actually matters.
  const since = new Date(now.getTime() - 31 * 24 * 3600 * 1000).toISOString();
  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select("id, listing_id, renter_id, hours, paid_at, booking_date, start_hour, spot_label, reminder_halfway_sent_at, reminder_ending_sent_at")
    .eq("status", "confirmed")
    .not("paid_at", "is", null)
    .gte("paid_at", since)
    .or("reminder_halfway_sent_at.is.null,reminder_ending_sent_at.is.null");

  if (error) {
    console.error("send-reminders: failed to load bookings:", error);
    return res.status(500).json({ error: "Failed to load bookings" });
  }

  const dueHalfway = [];
  const dueEnding = [];

  for (const b of bookings || []) {
    const { start, end } = getSessionWindow(b);
    const startMs = start.getTime();
    const endMs = end.getTime();
    const nowMs = now.getTime();
    if (nowMs < startMs || nowMs >= endMs) continue; // session hasn't started yet, or already ended

    const halfway = startMs + (endMs - startMs) / 2;
    const endingAt = endMs - ENDING_SOON_MINUTES * 60 * 1000;

    if (!b.reminder_halfway_sent_at && nowMs >= halfway) dueHalfway.push({ ...b, end: endMs });
    if (!b.reminder_ending_sent_at && nowMs >= endingAt) dueEnding.push({ ...b, end: endMs });
  }

  const results = { halfwaySent: 0, endingSent: 0, failed: 0 };

  for (const b of dueHalfway) {
    try {
      await sendReminder(b, "halfway");
      results.halfwaySent++;
    } catch (err) {
      console.error("send-reminders: halfway email failed for booking", b.id, err);
      results.failed++;
    }
  }

  for (const b of dueEnding) {
    try {
      await sendReminder(b, "ending");
      results.endingSent++;
    } catch (err) {
      console.error("send-reminders: ending email failed for booking", b.id, err);
      results.failed++;
    }
  }

  return res.status(200).json(results);
}

async function sendReminder(booking, kind) {
  const [{ data: listing }, { data: renter }] = await Promise.all([
    supabaseAdmin.from("listings").select("title, address, host_id").eq("id", booking.listing_id).single(),
    supabaseAdmin.from("profiles").select("name, email").eq("id", booking.renter_id).single(),
  ]);
  if (!renter?.email) return;

  let hostEmail = null;
  if (listing?.host_id) {
    const { data: host } = await supabaseAdmin.from("profiles").select("email").eq("id", listing.host_id).single();
    hostEmail = host?.email || null;
  }

  const minutesLeft = Math.max(0, Math.round((booking.end - Date.now()) / 60000));
  const endDate = new Date(booking.end);
  const endDateStr = endDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const endTimeStr = endDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const listingTitle = listing?.title || "your listing";
  const address = listing?.address || "";
  const renterName = renter.name || "there";

  const templateArgs = { renterName, listingTitle, address, spotLabel: booking.spot_label, minutesLeft, endTimeStr, endDateStr };

  const { subject, html, column } =
    kind === "halfway"
      ? {
          subject: "Halfway through your parking session",
          html: halfwayReminderHtml(templateArgs),
          column: "reminder_halfway_sent_at",
        }
      : {
          subject: "Your parking session ends soon",
          html: endingReminderHtml(templateArgs),
          column: "reminder_ending_sent_at",
        };

  await sendEmail({ to: renter.email, cc: hostEmail || undefined, subject, html });

  // Mark as sent immediately after a successful send so a later run in the
  // same cron cycle (or an overlapping one) never sends it twice.
  await supabaseAdmin.from("bookings").update({ [column]: new Date().toISOString() }).eq("id", booking.id);
}

