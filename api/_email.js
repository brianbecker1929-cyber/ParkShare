// api/_email.js
//
// Shared email sending helper, used by stripe-webhook.js (booking
// confirmation) and send-reminders.js (halfway + ending reminders).
//
// Requires these environment variables:
//   RESEND_API_KEY — from resend.com/api-keys
//   EMAIL_FROM     — a sender address on a domain you've verified in Resend,
//                     e.g. "ParkShare <bookings@myparkshare.ca>". Until a
//                     domain is verified, Resend only lets you send to your
//                     own account email using onboarding@resend.dev — fine
//                     for testing, not for real users.
//
// CHANGE LOG (this revision):
//   - halfwayReminderHtml() now renders from the new reminder-halfway
//     template — same visual design as the confirmation and ending-soon
//     reminder emails (navy header, white body, stacked spot map, ESKA
//     footer). All three email types are now visually consistent.
//   - Removed the old inline-HTML halfway design (shell/brandHeader/
//     confirmationDetailRow helpers) — nothing references them anymore.
//   - halfwayReminderHtml()'s signature changed to match endingReminderHtml()
//     (now needs hostName, locationId, directionsUrl, manageReservationUrl,
//     supportEmail, supportPhone — see send-reminders.js for the update
//     that supplies these).
//   - KNOWN GAP: the confirmation template has no price/payment summary and
//     no "booked in advance vs. already started" distinction — both of
//     which the old design showed. That content was intentionally not
//     smuggled back into your finished template; flagging it here so it's
//     a deliberate decision, not a silent regression. See stripe-webhook.js
//     comments at the confirmationEmailHtml() call site.

import { fillTemplate } from "./emails/_render.js";
import confirmationTemplate from "./emails/templates/_parking-confirmation.template.js";
import endingReminderTemplate from "./emails/templates/_reminder-ending.template.js";
import halfwayReminderTemplate from "./emails/templates/_reminder-halfway.template.js";
import extensionConfirmedTemplate from "./emails/templates/_extension-confirmed.template.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "ParkShare <onboarding@resend.dev>";

export async function sendEmail({ to, cc, subject, html, attachments }) {
  if (!RESEND_API_KEY) {
    console.error("[_email] RESEND_API_KEY is not set — skipping send:", subject);
    return { skipped: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      cc: cc ? [cc] : undefined,
      subject,
      html,
      attachments: attachments && attachments.length ? attachments : undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
  return res.json();
}


function escapeBookingHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// A separate notification: do not CC the host on the renter's personal
// confirmation. Both recipients get the same exact booked-car driveway PNG.
export function hostBookingNotificationHtml({
  hostName, address, spotLabel, vehicle, startLabel, endLabel, bookingId, spotImageCid,
}) {
  const e = escapeBookingHtml;
  const car = [vehicle?.vehicle_make, vehicle?.vehicle_model].filter(Boolean).join(" ") || "Vehicle not specified";
  const colour = vehicle?.vehicle_colour || "Colour not specified";
  const plate = vehicle?.license_plate || "Not provided";
  const picture = spotImageCid
    ? `<img src="cid:${e(spotImageCid)}" alt="Top-down vehicle in reserved Spot ${e(spotLabel)}" width="360" style="display:block;width:100%;max-width:360px;height:auto;margin:16px auto;border-radius:9px;border:1px solid #E3DDC9;">`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#FAF7F0;color:#0E1B2E;margin:0;padding:22px 12px;">
  <main style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E3DDC9;">
    <header style="background:#0E1B2E;color:white;padding:20px 24px;border-bottom:4px solid #FFC107;">
      <strong style="font-size:24px;">Park<span style="color:#FFC107;">Share</span></strong>
    </header>
    <section style="padding:24px;">
      <h1 style="font-size:22px;">New driveway booking</h1>
      <p>Hi ${e(hostName || "Host")}, a driver has reserved a space at your property.</p>
      <p><strong>Address:</strong> ${e(address)}</p>
      <p><strong>Reserved space:</strong> Spot ${e(spotLabel || "—")}</p>
      <p><strong>Vehicle:</strong> ${e(car)} · ${e(colour)}</p>
      <p><strong>Licence plate:</strong> ${e(plate)}</p>
      <p><strong>Start:</strong> ${e(startLabel)}</p>
      <p><strong>End:</strong> ${e(endLabel)}</p>
      <p><strong>Booking:</strong> PK-${e(bookingId)}</p>
      ${picture}
      <p style="font-size:13px;color:#71695A;">This is a visual reference of the reserved space and expected vehicle, not confirmation that the vehicle has arrived.</p>
      <a href="https://www.myparkshare.ca/" style="display:inline-block;background:#FFC107;color:#0E1B2E;font-weight:bold;text-decoration:none;padding:12px 18px;border-radius:8px;">Open Host Dashboard</a>
    </section>
  </main>
</body></html>`;
}

// ---------------------------------------------------------------------
// Booking confirmation
// ---------------------------------------------------------------------
//
// spotImageCid: if provided, the spot-map image renders via the same
// `cid:` attachment approach the old design used (the image is generated
// fresh per booking, so it can't be a static hosted URL). If it's missing
// (image generation failed upstream), we fall back to hiding the image
// row entirely rather than leaving a broken image in the email.
export function confirmationEmailHtml({
  renterName,
  hostName,
  address,
  locationId,
  spotLabel,
  confirmationNumber,
  startDateLabel,
  startTimeStr,
  entryDateFull,
  endTimeStr,
  exitDateFull,
  spotImageCid,
  directionsUrl,
  manageReservationUrl,
  supportEmail,
  supportPhone,
}) {
  return fillTemplate(confirmationTemplate, {
    CUSTOMER_FIRST_NAME: renterName,
    HOST_NAME: hostName,
    GARAGE_ADDRESS: address,
    LOCATION_ID: locationId,
    SPOT_LABEL: spotLabel ? `Spot ${spotLabel}` : "—",
    CONFIRMATION_NUMBER: confirmationNumber,
    SESSION_START_DATE_LABEL: startDateLabel,
    SESSION_START_TIME: startTimeStr,
    ENTRY_DATE_FULL: entryDateFull,
    SESSION_END_TIME: endTimeStr,
    EXIT_DATE_FULL: exitDateFull,
    SPOT_MAP_IMAGE_URL: spotImageCid ? `cid:${spotImageCid}` : "",
    DIRECTIONS_URL: directionsUrl,
    MANAGE_RESERVATION_URL: manageReservationUrl,
    SUPPORT_EMAIL: supportEmail,
    SUPPORT_PHONE: supportPhone,
    CURRENT_YEAR: new Date().getFullYear(),
  });
}

// ---------------------------------------------------------------------
// Shared field-mapping for the two reminder emails — same shape, just a
// different template and different framing of TIME_REMAINING.
// ---------------------------------------------------------------------
function reminderFields({
  renterName,
  hostName,
  address,
  locationId,
  spotLabel,
  timeRemaining,
  endDateLabel,
  endTimeStr,
  exitDateFull,
  spotImageCid,
  directionsUrl,
  manageReservationUrl,
  extendUrl,
  supportEmail,
  supportPhone,
}) {
  return {
    CUSTOMER_FIRST_NAME: renterName,
    HOST_NAME: hostName,
    GARAGE_ADDRESS: address,
    LOCATION_ID: locationId,
    SPOT_LABEL: spotLabel ? `Spot ${spotLabel}` : "—",
    TIME_REMAINING: timeRemaining,
    SESSION_END_DATE_LABEL: endDateLabel,
    SESSION_END_TIME: endTimeStr,
    EXIT_DATE_FULL: exitDateFull,
    SPOT_MAP_IMAGE_URL: spotImageCid ? `cid:${spotImageCid}` : "",
    DIRECTIONS_URL: directionsUrl,
    MANAGE_RESERVATION_URL: manageReservationUrl,
    EXTEND_URL: extendUrl,
    SUPPORT_EMAIL: supportEmail,
    SUPPORT_PHONE: supportPhone,
    CURRENT_YEAR: new Date().getFullYear(),
  };
}

// ---------------------------------------------------------------------
// Ending-soon reminder
// ---------------------------------------------------------------------
export function endingReminderHtml(args) {
  return fillTemplate(endingReminderTemplate, reminderFields(args));
}

// ---------------------------------------------------------------------
// Halfway reminder — now matches the confirmation/ending-reminder design.
// ---------------------------------------------------------------------
export function halfwayReminderHtml(args) {
  return fillTemplate(halfwayReminderTemplate, reminderFields(args));
}

// ---------------------------------------------------------------------
// Extension confirmed — sent after a successful "Add Additional Time"
// payment. See stripe-webhook.js's confirmExtension() for the call site.
// ---------------------------------------------------------------------
export function extensionConfirmedHtml({
  renterName,
  hostName,
  address,
  locationId,
  spotLabel,
  addedTime,
  amountCharged,
  newEndTime,
  newEndDateFull,
  spotImageCid,
  directionsUrl,
  manageReservationUrl,
  extendUrl,
  supportEmail,
  supportPhone,
}) {
  return fillTemplate(extensionConfirmedTemplate, {
    CUSTOMER_FIRST_NAME: renterName,
    HOST_NAME: hostName,
    GARAGE_ADDRESS: address,
    LOCATION_ID: locationId,
    SPOT_LABEL: spotLabel ? `Spot ${spotLabel}` : "—",
    ADDED_TIME: addedTime,
    AMOUNT_CHARGED: amountCharged,
    NEW_END_TIME: newEndTime,
    NEW_END_DATE_FULL: newEndDateFull,
    SPOT_MAP_IMAGE_URL: spotImageCid ? `cid:${spotImageCid}` : "",
    DIRECTIONS_URL: directionsUrl,
    MANAGE_RESERVATION_URL: manageReservationUrl,
    EXTEND_URL: extendUrl,
    SUPPORT_EMAIL: supportEmail,
    SUPPORT_PHONE: supportPhone,
    CURRENT_YEAR: new Date().getFullYear(),
  });
}

