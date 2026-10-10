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
import hostBookingTemplate from "./emails/templates/_host-booking.template.js";
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

// Send a separate, fully branded Host notification using the same table-based
// email design, typography, palette and footer as the Driver confirmation.
// Do not CC the Host on the Driver email. All booking values are HTML-escaped.
export function hostBookingNotificationHtml({
  hostName, address, spotLabel, vehicle, startLabel, endLabel, bookingId,
  driverName, spotImageCid, spotImageSrc,
}) {
  const e = escapeBookingHtml;
  const label = /^[A-Z]$/.test(String(spotLabel || "").trim().toUpperCase())
    ? `Spot ${String(spotLabel).trim().toUpperCase()}` : "Spot not specified";
  const car = [vehicle?.vehicle_make || vehicle?.vehicleMake, vehicle?.vehicle_model || vehicle?.vehicleModel]
    .filter(Boolean).join(" ") || "Vehicle not specified";
  const colour = vehicle?.vehicle_colour || vehicle?.vehicleColour || "Colour not specified";
  const plate = String(vehicle?.license_plate || vehicle?.licensePlate || "Not provided").toUpperCase();
  // Resend CID attachment in real emails; a PNG data URL is allowed strictly
  // for a synthetic, preview-only browser render (no real customer data).
  const imageSrc = spotImageSrc || (spotImageCid ? `cid:${spotImageCid}` : "");
  const safeSrc = /^(?:cid:[a-zA-Z0-9_-]+|data:image\/png;base64,[a-zA-Z0-9+/=]+)$/.test(imageSrc) ? imageSrc : "";
  const mapBlock = safeSrc
    ? `<img src="${e(safeSrc)}" width="300" alt="Top-down diagram showing the ${e(colour)} ${e(car)} in ${e(label)}" style="display:block;width:300px;max-width:100%;height:auto;margin:0 auto;border:1px solid #e2e6ee;border-radius:8px;">`
    : '<p style="margin:0;font-size:12px;color:#71695a;">Driveway preview unavailable. Refer to the spot label above.</p>';
  return fillTemplate(hostBookingTemplate, {
    HOST_NAME: e(hostName || "Host"),
    PROPERTY_ADDRESS: e(address || "Property address unavailable"),
    DRIVER_NAME: e(driverName || "ParkShare Driver"),
    SPOT_LABEL: e(label),
    BOOKING_NUMBER: e(`PK-${bookingId}`),
    START_DATE_TIME: e(startLabel || "Not provided"),
    END_DATE_TIME: e(endLabel || "Not provided"),
    START_TIME_SUMMARY: e(startLabel || "Not provided"),
    VEHICLE_DETAILS: e(`${car} · ${colour}`),
    VEHICLE_PLATE: e(plate),
    SPOT_MAP_BLOCK: mapBlock,
    HOST_DASHBOARD_URL: "https://www.myparkshare.ca/host-dashboard",
  });
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
  vehicleSummary,
  vehiclePlate,
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
    BOOKED_VEHICLE_SUMMARY: escapeBookingHtml(vehicleSummary || "Vehicle not specified"),
    BOOKED_VEHICLE_PLATE: escapeBookingHtml(vehiclePlate || "Not provided"),
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

