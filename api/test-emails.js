// GET /api/test-emails?to=you@example.com&secret=<CRON_SECRET>
//
// One-time debug utility — sends both the confirmation and reminder email
// templates to a real address using real, realistic sample data, so you can
// see exactly what a renter/host actually receives without needing to make
// a real booking first. Reuses CRON_SECRET (already set) rather than
// requiring a new env var, so this can't be triggered by a random visitor.
//
// Safe to delete this file after you've confirmed the emails look right —
// it's not part of the real booking flow, just a way to trigger a real send
// on demand.

import { sendEmail, confirmationEmailHtml, halfwayReminderHtml, endingReminderHtml } from "./_email.js";
import { renderParkingSpotImage } from "./_driveway-image.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.CRON_SECRET;
  if (secret && req.query?.secret !== secret) {
    return res.status(401).json({ error: "Unauthorized — pass ?secret=<your CRON_SECRET>" });
  }

  const to = req.query?.to;
  if (!to) {
    return res.status(400).json({ error: "Missing ?to=you@example.com" });
  }

  // NOTE: spot_label is stored as just the bare letter ("D"), never "Spot D"
  // — that prefix only gets added inside confirmationEmailHtml/
  // endingReminderHtml. Sample data here matches the real shape so this
  // actually exercises the same code path a real booking does, including
  // the image-index parsing.
  const sampleConfirmation = {
    renterName: "Laura",
    hostName: "Green P",
    address: "123 Maple Drive, Toronto, ON M4B 2T5",
    locationId: 195,
    spotLabel: "D",
    confirmationNumber: "PK-482913",
    startDateLabel: "Today",
    startTimeStr: "2:46 PM",
    entryDateFull: "Thu, July 24, 2026",
    endTimeStr: "4:46 PM",
    exitDateFull: "Thu, July 24, 2026",
    directionsUrl: "https://www.google.com/maps/search/?api=1&query=123+Maple+Drive+Toronto+ON",
    manageReservationUrl: "https://www.myparkshare.ca/bookings/test",
    supportEmail: process.env.SUPPORT_EMAIL || "support@myparkshare.ca",
    supportPhone: process.env.SUPPORT_PHONE || "(555) 123-4567",
  };

  const sampleReminder = {
    renterName: "Laura",
    hostName: "Green P",
    address: "123 Maple Drive, Toronto, ON M4B 2T5",
    locationId: 195,
    spotLabel: "D",
    endDateLabel: "Today",
    endTimeStr: "4:46 PM",
    exitDateFull: "Thursday, July 24, 2026",
    directionsUrl: "https://www.google.com/maps/search/?api=1&query=123+Maple+Drive+Toronto+ON",
    manageReservationUrl: "https://www.myparkshare.ca/bookings/test",
    supportEmail: process.env.SUPPORT_EMAIL || "support@myparkshare.ca",
    supportPhone: process.env.SUPPORT_PHONE || "(555) 123-4567",
  };
  const sampleEndingReminder = { ...sampleReminder, timeRemaining: "15 minutes" };
  const sampleHalfwayReminder = { ...sampleReminder, timeRemaining: "60 minutes" };

  const results = {};

  try {
    // A(available), B(available), C(not for rent), D(chosen) — same shape
    // as a real booking on a 2-space listing where spot D was picked.
    const spotStates = [true, true, false, true];
    const chosenIndex = 3; // D
    const imageBuffer = await renderParkingSpotImage(spotStates, chosenIndex);
    const spotImageCid = "test-parking-spot-confirmation";

    await sendEmail({
      to,
      subject: "[TEST] Booking confirmed — 123 Maple Drive",
      html: confirmationEmailHtml({ ...sampleConfirmation, spotImageCid }),
      attachments: [{
        filename: "parking-spot.png",
        content: imageBuffer.toString("base64"),
        content_id: spotImageCid,
      }],
    });
    results.confirmation = "sent (with spot image)";
  } catch (err) {
    results.confirmation = "failed: " + err.message;
  }

  try {
    const spotStates = [true, true, false, true];
    const chosenIndex = 3;
    const imageBuffer = await renderParkingSpotImage(spotStates, chosenIndex);
    const spotImageCid = "test-parking-spot-ending";

    await sendEmail({
      to,
      subject: "[TEST] Your parking session ends soon",
      html: endingReminderHtml({ ...sampleEndingReminder, spotImageCid }),
      attachments: [{
        filename: "parking-spot.png",
        content: imageBuffer.toString("base64"),
        content_id: spotImageCid,
      }],
    });
    results.endingReminder = "sent (with spot image)";
  } catch (err) {
    results.endingReminder = "failed: " + err.message;
  }

  try {
    const spotStates = [true, true, false, true];
    const chosenIndex = 3;
    const imageBuffer = await renderParkingSpotImage(spotStates, chosenIndex);
    const spotImageCid = "test-parking-spot-halfway";

    await sendEmail({
      to,
      subject: "[TEST] Halfway through your parking session",
      html: halfwayReminderHtml({ ...sampleHalfwayReminder, spotImageCid }),
      attachments: [{
        filename: "parking-spot.png",
        content: imageBuffer.toString("base64"),
        content_id: spotImageCid,
      }],
    });
    results.halfwayReminder = "sent (with spot image)";
  } catch (err) {
    results.halfwayReminder = "failed: " + err.message;
  }

  return res.status(200).json(results);
}
