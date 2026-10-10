// Browser-based, sample-only email QA. Available on Vercel PREVIEW
// deployments, never production. Does not send email or access customer data.
import { hostBookingNotificationHtml } from "./_email.js";
import { renderParkingSpotImage } from "./_driveway-image.js";
import { renderHostLogoPng, renderHostPortraitPng } from "./_host-logo.js";
import { formatBookingEmailTimes } from "./_booking-email-times.js";
import { sampleEmailBooking } from "./_email-preview.js";

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
    const { vehicle, spotLabel, spotStates, chosenIndex } = sampleEmailBooking(req.query);
    const start = new Date("2026-10-09T23:36:00.000Z");
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const times = formatBookingEmailTimes(start, end, start);
    const [image, signatureLogo, williamPortrait] = await Promise.all([
      renderParkingSpotImage(spotStates, chosenIndex, vehicle),
      renderHostLogoPng(),
      renderHostPortraitPng(),
    ]);
    const html = hostBookingNotificationHtml({
      hostName: "Sample Host",
      address: "12 Example Crescent, Vaughan, Ontario",
      spotLabel,
      vehicle,
      startLabel: times.hostStartLabel,
      endLabel: times.hostEndLabel,
      startTimeStr: times.startTimeStr,
      entryDateFull: times.entryDateFull,
      endTimeStr: times.endTimeStr,
      exitDateFull: times.exitDateFull,
      bookingId: "DEMO",
      amountCharged: "$5.00 CAD",
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
