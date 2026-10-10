// Render the existing, UNCHANGED Driver/Renter booking confirmation template.
// This is a sample-only, read-only visual comparison for Host email QA.
// Vercel preview deployments only: no customer records, payments, or emails.
import { confirmationEmailHtml } from "./_email.js";
import { renderParkingSpotImage } from "./_driveway-image.js";
import { renderHostLogoPng } from "./_host-logo.js";
import { formatBookingEmailTimes } from "./_booking-email-times.js";

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") return res.status(404).end("Not found");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method not allowed");
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  try {
    const sampleVehicle = {
      vehicle_make: "Lexus",
      vehicle_model: "LC",
      vehicle_colour: "Orange",
      license_plate: "DEMO 123",
    };
    const start = new Date("2026-10-09T23:36:00.000Z");
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const labels = formatBookingEmailTimes(start, end, start);
    const [mapPng, signatureLogo] = await Promise.all([
      renderParkingSpotImage([false, true, false, false], 1, sampleVehicle),
      renderHostLogoPng(),
    ]);

    const html = confirmationEmailHtml({
      renterName: "Sample Driver",
      hostName: "Sample Host",
      address: "12 Example Crescent, Vaughan, Ontario",
      locationId: "DEMO",
      spotLabel: "B",
      confirmationNumber: "PK-DEMO",
      startDateLabel: labels.startDateLabel,
      startTimeStr: labels.startTimeStr,
      entryDateFull: labels.entryDateFull,
      endTimeStr: labels.endTimeStr,
      exitDateFull: labels.exitDateFull,
      spotImageCid: "parking-spot-demo",
      logoSrc: `data:image/png;base64,${signatureLogo.toString("base64")}`,
      vehicleSummary: "Lexus LC · Orange",
      vehiclePlate: "DEMO 123",
      directionsUrl: "https://www.myparkshare.ca/parking",
      manageReservationUrl: "https://www.myparkshare.ca/my-bookings",
      supportEmail: "info@myparkshare.ca",
      supportPhone: "Not provided",
    });
    const inlineImage = `data:image/png;base64,${mapPng.toString("base64")}`;
    const withImage = html.replaceAll("cid:parking-spot-demo", inlineImage);
    const previewNotice = '<div style="background:#FFC107;padding:12px 18px;font:700 13px/1.45 Arial,sans-serif;color:#0E1B2E;text-align:center;">RENTER EMAIL DESIGN PREVIEW · SAMPLE BOOKING · NO EMAIL SENT</div>';
    return res.status(200).send(withImage.replace(/<body([^>]*)>/i, `<body$1>${previewNotice}`));
  } catch (error) {
    console.error("Renter confirmation email preview failed:", error);
    return res.status(500).end("Could not render the Renter email preview");
  }
}
