// GET /api/send-reminders — authenticated Vercel Cron, once per minute.
// Halfway and 15-minute ending reminders use canonical session times.
// Delivery snapshots, leases and provider idempotency live in
// _reminder-delivery.js. Messages go to the Driver, CC'd to the Host.

import { SUPPORT_EMAIL } from "../src/lib/supportContact.js";
import { supabaseAdmin, getSessionWindow } from "./_lib.js";
import { halfwayReminderHtml, endingReminderHtml } from "./_email.js";
import { renderParkingSpotImage, deriveEmailSpotStates } from "./_driveway-image.js";
import { renderHostLogoPng, renderDriverPortraitPng } from "./_host-logo.js";
import { formatBookingEmailTimes } from "./_booking-email-times.js";

import { timingSafeEqual } from "node:crypto";
import { deliverReminder } from "./_reminder-delivery.js";
import { dueReminder } from "./_reminder-window.js";


export default async function handler(req, res) {
  res.setHeader?.("Cache-Control", "private, no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(503).json({ error: "Reminder service is not configured." });
  const authHeader = req.headers.authorization || "";
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(authHeader);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return res.status(503).json({ error: "Reminder email is not configured." });
  }
  const now = new Date();

  // Do not filter on paid_at: Drivers may book and pay MONTHS before an
  // upcoming session. The canonical start/end, not payment age, decides
  // whether a reminder is due.
  const bookings = [];
  // Supabase caps responses; page by primary key so older paid bookings do
  // not hide today's active scheduled sessions beyond the first 1,000 rows.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .select("id, listing_id, renter_id, hours, paid_at, booking_date, start_hour, scheduled_starts_at, property_time_zone, spot_label, vehicle_type, vehicle_make, vehicle_model, vehicle_colour, license_plate, status, reminder_halfway_sent_at, reminder_ending_sent_at")
      .eq("status", "confirmed")
      .not("paid_at", "is", null)
      .or("reminder_halfway_sent_at.is.null,reminder_ending_sent_at.is.null")
      .order("id").range(offset, offset + 499);
    if (error) {
      console.error("send-reminders: failed to load bookings");
      return res.status(500).json({ error: "Failed to load bookings" });
    }
    bookings.push(...(data || []));
    if (!data || data.length < 500) break;
  }

  const dueHalfway = [];
  const dueEnding = [];

  let invalid = 0;
  for (const b of bookings || []) {
    try {
      const due = dueReminder(b, now.getTime());
      if (due?.kind === "halfway") dueHalfway.push({ ...b, end: due.end });
      if (due?.kind === "ending") dueEnding.push({ ...b, end: due.end });
    } catch {
      console.error("send-reminders: invalid session for booking", b.id);
      invalid++;
    }
  }

  const results = { halfwaySent: 0, endingSent: 0, failed: invalid };

  const deadline = Date.now() + 240_000;
  for (const b of dueHalfway) {
    if (Date.now() >= deadline) break;
    try {
      if (await sendReminder(b, "halfway")) results.halfwaySent++;
    } catch (err) {
      console.error("send-reminders: halfway email failed for booking", b.id, err.message);
      results.failed++;
    }
  }

  for (const b of dueEnding) {
    if (Date.now() >= deadline) break;
    try {
      if (await sendReminder(b, "ending")) results.endingSent++;
    } catch (err) {
      console.error("send-reminders: ending email failed for booking", b.id, err.message);
      results.failed++;
    }
  }

  console.info("send-reminders: completed", JSON.stringify(results));
  return res.status(200).json(results);
}

async function sendReminder(booking, kind) {
  const { data: listing, error: listingError } = await supabaseAdmin
    .from("listings")
    .select("title, address, spaces, spots, host_id")
    .eq("id", booking.listing_id)
    .single();
  if (listingError || !listing) throw new Error("Reminder listing could not be loaded");
  const { data: renter, error: renterError } = await supabaseAdmin
    .from("profiles")
    .select("name, email")
    .eq("id", booking.renter_id)
    .single();
  if (renterError || !renter?.email) throw new Error("Reminder Driver email is missing");

  let hostEmail = null;
  let hostName = "your host";
  if (listing?.host_id) {
    const { data: host, error: hostError } = await supabaseAdmin.from("profiles").select("name, email").eq("id", listing.host_id).single();
    if (hostError || !host?.email) throw new Error("Reminder Host email is missing");
    hostEmail = host.email;
    hostName = host?.name || hostName;
  }

  const nowDate = new Date();
  const minutesLeft = Math.max(0, Math.round((booking.end - Date.now()) / 60000));
  const endDate = new Date(booking.end);
  const { start } = getSessionWindow(booking);
  const times = formatBookingEmailTimes(start, endDate, nowDate, booking.property_time_zone || "UTC");
  const address = listing?.address || "";
  const renterName = renter.name || "there";

  // Same spot-map generation stripe-webhook.js uses for the confirmation
  // email — regenerated here since a booking's spot assignment doesn't
  // change, but there's no image saved anywhere to reuse. Best-effort: if
  // this fails, the reminder still sends, just without the image. Used by
  // BOTH reminder kinds now, since both templates have an image slot.
  let spotImageCid, logoCid, portraitCid;
  const attachments = [];
  try {
    const chosenIndex = booking.spot_label
      ? booking.spot_label.trim().toUpperCase().charCodeAt(0) - 65
      : null;
    const spotStates = deriveEmailSpotStates(listing || {}, chosenIndex);
    const imageBuffer = await renderParkingSpotImage(spotStates, chosenIndex, booking);
    spotImageCid = "parking-spot-" + booking.id;
    attachments.push({
      filename: "parking-spot.png",
      content: imageBuffer.toString("base64"),
      content_id: spotImageCid,
    });
  } catch (err) {
    console.error("send-reminders: failed to generate parking spot image (sending without it):", err);
  }

  try {
    const logoBuffer = await renderHostLogoPng();
    logoCid = "parkshare-signature-logo-" + booking.id;
    attachments.push({ filename: "parkshare-signature-logo.png", content: logoBuffer.toString("base64"), content_id: logoCid });
  } catch (err) {
    console.error("send-reminders: using hosted signature logo:", err);
  }
  try {
    const portrait = await renderDriverPortraitPng();
    portraitCid = "parkshare-parker-portrait-" + booking.id;
    attachments.push({ filename: "parkshare-parker-portrait.png", content: portrait.toString("base64"), content_id: portraitCid });
  } catch (err) {
    console.error("send-reminders: using hosted Parker portrait:", err);
  }

  const commonFields = {
    logoCid,
    portraitCid,
    bookingId: booking.id,
    renterName,
    hostName,
    address,
    locationId: booking.listing_id,
    spotLabel: booking.spot_label,
    timeRemaining: `${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}`,
    timeZoneLabel: times.timeZoneLabel,
    endTimeStr: times.endTimeStr,
    exitDateFull: times.exitDateFull,
    vehicleSummary: [booking.vehicle_make, booking.vehicle_model, booking.vehicle_colour].filter(Boolean).join(" · ") || "Vehicle not specified",
    vehiclePlate: booking.license_plate || "Not provided",
    spotImageCid,
    directionsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    manageReservationUrl: `https://www.myparkshare.ca/?view_booking=${booking.id}`,
    // Read by App.jsx's top-level query-param handling — opens
    // ExtendSessionModal directly for this booking, same pattern already
    // used for booking_success/booking_cancelled/stripe_onboarding.
    extendUrl: `https://www.myparkshare.ca/?extend_booking=${booking.id}`,
    supportEmail: process.env.SUPPORT_EMAIL || SUPPORT_EMAIL,
    supportPhone: process.env.SUPPORT_PHONE || "(555) 123-4567",
  };

  const isHalfway = kind === "halfway";
  const subject = isHalfway
    ? "Halfway through your parking session"
    : "Your parking session ends soon";
  const html = isHalfway ? halfwayReminderHtml(commonFields) : endingReminderHtml(commonFields);
  return deliverReminder(supabaseAdmin, booking, kind,
    { to: renter.email, cc: hostEmail || undefined, subject, html, attachments });
}
