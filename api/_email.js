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
// All five notifications share the approved compact Booking Ticket layout.
// Customer fields are escaped; booking-specific images remain inline CID PNGs.

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

// Real mail uses CID attachments, sample previews use inline data, and each
// approved image has a hosted PNG fallback produced by the production build.
function approvedImageUrl({ src, cid }, fallback) {
  const candidate = src || (cid ? `cid:${cid}` : fallback);
  return /^(?:cid:[a-zA-Z0-9_-]+|data:image\/png;base64,[a-zA-Z0-9+/=]+)$/.test(candidate) || candidate === fallback
    ? candidate : fallback;
}
function signatureLogoUrl({ logoSrc, logoCid }) {
  return approvedImageUrl({ src: logoSrc, cid: logoCid }, "https://www.myparkshare.ca/email/parkshare-signature-logo.png");
}
function portraitUrl({ portraitSrc, portraitCid }, host = false) {
  return approvedImageUrl({ src: portraitSrc, cid: portraitCid }, `https://www.myparkshare.ca/email/parkshare-${host ? 'william' : 'parker'}-portrait.png`);
}
function actionUrl(value) {
  return /^https:\/\/[^\s<>]+$/.test(String(value || "")) ? value : "https://www.myparkshare.ca/my-bookings";
}
function mapBlock({ spotImageSrc, spotImageCid }, alt) {
  const src = approvedImageUrl({ src: spotImageSrc, cid: spotImageCid }, "");
  return src
    ? `<img class="ps-ticket-map" src="${escapeBookingHtml(src)}" width="180" alt="${escapeBookingHtml(alt)}" style="display:block;width:180px;max-width:100%;height:auto;margin:5px auto 0;border-radius:8px;border:0;">`
    : '<p style="margin:5px 0 0;font-size:12px;line-height:17px;color:#617080;">Driveway preview unavailable. Refer to the spot label above.</p>';
}
function spotLabel(value) {
  const label = String(value || "").trim().toUpperCase();
  return /^[A-D]$/.test(label) ? `Spot ${label}` : "Spot not specified";
}
function bookingNumber({ confirmationNumber, bookingId }) {
  return confirmationNumber || (bookingId != null ? `PK-${bookingId}` : "Not provided");
}
function driverTicketFields(args) {
  const e = escapeBookingHtml;
  const label = spotLabel(args.spotLabel);
  const vehicle = args.vehicleSummary || "Vehicle not specified";
  return {
    BOOKING_LOGO_URL: e(signatureLogoUrl(args)),
    DRIVER_PORTRAIT_URL: e(portraitUrl(args)),
    CUSTOMER_FIRST_NAME: e(args.renterName || "there"),
    HOST_NAME: e(args.hostName || "Your host"),
    GARAGE_ADDRESS: e(args.address || "Parking address unavailable"),
    LOCATION_ID: e(args.locationId || "Not provided"),
    SPOT_LABEL: e(label),
    CONFIRMATION_NUMBER: e(bookingNumber(args)),
    SESSION_START_TIME: e(args.startTimeStr || "Not provided"),
    ENTRY_DATE_FULL: e(args.entryDateFull || ""),
    SESSION_END_TIME: e(args.endTimeStr || "Not provided"),
    EXIT_DATE_FULL: e(args.exitDateFull || ""),
    TIME_REMAINING: e(args.timeRemaining || "Not provided"),
    ADDED_TIME: e(args.addedTime || "Not provided"),
    AMOUNT_CHARGED: e(args.amountCharged || "Not provided"),
    NEW_END_TIME: e(args.newEndTime || "Not provided"),
    NEW_END_DATE_FULL: e(args.newEndDateFull || ""),
    BOOKED_VEHICLE_SUMMARY: e(vehicle),
    BOOKED_VEHICLE_PLATE: e(String(args.vehiclePlate || "Not provided").toUpperCase()),
    SPOT_MAP_BLOCK: mapBlock(args, `Top-down diagram showing ${vehicle} in ${label}`),
    DIRECTIONS_URL: e(actionUrl(args.directionsUrl)),
    MANAGE_RESERVATION_URL: e(actionUrl(args.manageReservationUrl)),
    EXTEND_URL: e(actionUrl(args.extendUrl)),
  };
}

export function hostBookingNotificationHtml(args) {
  const e = escapeBookingHtml;
  const label = spotLabel(args.spotLabel);
  const vehicle = args.vehicle || {};
  const car = [vehicle.vehicle_make || vehicle.vehicleMake, vehicle.vehicle_model || vehicle.vehicleModel].filter(Boolean).join(" ") || "Vehicle not specified";
  const colour = vehicle.vehicle_colour || vehicle.vehicleColour || "Colour not specified";
  const plate = String(vehicle.license_plate || vehicle.licensePlate || "Not provided").toUpperCase();
  return fillTemplate(hostBookingTemplate, {
    BOOKING_LOGO_URL: e(signatureLogoUrl(args)),
    HOST_PORTRAIT_URL: e(portraitUrl(args, true)),
    HOST_NAME: e(args.hostName || "Host"),
    PROPERTY_ADDRESS: e(args.address || "Property address unavailable"),
    DRIVER_NAME: e(args.driverName || "ParkShare Driver"),
    SPOT_LABEL: e(label),
    BOOKING_NUMBER: e(`PK-${args.bookingId}`),
    AMOUNT_CHARGED: e(args.amountCharged || "Not provided"),
    // Older callers may pass combined labels; new sends use separate times
    // and dates so both columns stay compact, including overnight bookings.
    HOST_START_TIME: e(args.startTimeStr || args.startLabel || "Not provided"),
    HOST_START_DATE: e(args.entryDateFull || ""),
    HOST_END_TIME: e(args.endTimeStr || args.endLabel || "Not provided"),
    HOST_END_DATE: e(args.exitDateFull || ""),
    VEHICLE_DETAILS: e(`${car} · ${colour}`),
    VEHICLE_PLATE: e(plate),
    SPOT_MAP_BLOCK: mapBlock(args, `Top-down diagram showing the ${colour} ${car} in ${label}`),
    HOST_DASHBOARD_URL: "https://www.myparkshare.ca/host-dashboard",
  });
}
export function confirmationEmailHtml(args) {
  return fillTemplate(confirmationTemplate, driverTicketFields(args));
}
export function halfwayReminderHtml(args) {
  return fillTemplate(halfwayReminderTemplate, driverTicketFields(args));
}
export function endingReminderHtml(args) {
  return fillTemplate(endingReminderTemplate, driverTicketFields(args));
}
export function extensionConfirmedHtml(args) {
  return fillTemplate(extensionConfirmedTemplate, driverTicketFields(args));
}
