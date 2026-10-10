// Browser-based, sample-only email QA. Available on Vercel PREVIEW
// deployments, never production. Does not send email or access customer data.
import { hostBookingNotificationHtml } from "./_email.js";
import { renderParkingSpotImage } from "./_driveway-image.js";
import { renderHostLogoPng, renderHostPortraitPng } from "./_host-logo.js";
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
    const vehicle = {
      vehicle_make: "Lexus",
      vehicle_model: "LC",
      vehicle_colour: "Orange",
      license_plate: "DEMO 123",
    };
    const start = new Date("2026-10-09T23:36:00.000Z");
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const times = formatBookingEmailTimes(start, end, start);
    const [image, signatureLogo, williamPortrait] = await Promise.all([
      renderParkingSpotImage([false, true, false, false], 1, vehicle),
      renderHostLogoPng(),
      renderHostPortraitPng(),
    ]);
    const html = hostBookingNotificationHtml({
      hostName: "Sample Host",
      address: "12 Example Crescent, Vaughan, Ontario",
      spotLabel: "B",
      vehicle,
      startLabel: times.hostStartLabel,
      endLabel: times.hostEndLabel,
      bookingId: "DEMO",
      driverName: "Sample Driver",
      // Use the actual approved PNG inline for preview so the logo works
      // even if Vercel's preview host blocks cross-origin image requests.
      logoSrc: `data:image/png;base64,${signatureLogo.toString("base64")}`,
      portraitSrc: `data:image/png;base64,${williamPortrait.toString("base64")}`,
      spotImageSrc: `data:image/png;base64,${image.toString("base64")}`,
    });
    return res.status(200).send(html.replace(
      "<body ",
      '<body data-sample-only="true" ',
    ).replace(
      "<table role=\"presentation\"",
      '<div style="padding:10px;background:#FFC107;color:#0E1B2E;text-align:center;font:700 13px Arial,sans-serif;">DESIGN PREVIEW ONLY · SAMPLE BOOKING · NO EMAIL SENT</div><table role="presentation"',
    ));
  } catch (error) {
    console.error("Host email sample preview failed:", error);
    return res.status(500).end("Host email preview could not be generated");
  }
}
