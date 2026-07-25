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
  // — that prefix only gets added for display. Sample data here matches the
  // real shape so this actually exercises the same code path a real booking
  // does, including the image-index parsing.
  const sampleConfirmation = {
    renterName: "Laura",
    listingTitle: "123 Maple Drive",
    address: "Toronto, ON  M4B 2T5",
    hours: 2,
    total: "14.00",
    spotLabel: "D",
    dateStr: "Thu, July 24, 2026",
    timeRangeStr: "2:46 PM – 4:46 PM (2 hrs)",
    isAdvance: false,
  };

  const sampleReminder = {
    renterName: "Laura",
    listingTitle: "123 Maple Drive",
    address: "Toronto, ON  M4B 2T5",
    spotLabel: "D",
    minutesLeft: 15,
    endTimeStr: "4:46 PM",
    endDateStr: "Thursday, July 24, 2026",
  };

  const results = {};

  try {
    // A(available), B(available), C(not for rent), D(chosen) — same shape
    // as a real booking on a 2-space listing where spot D was picked.
    const spotStates = [true, true, false, true];
    const chosenIndex = 3; // D
    const imageBuffer = await renderParkingSpotImage(spotStates, chosenIndex);
    const spotImageCid = "test-parking-spot";

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
    await sendEmail({
      to,
      subject: "[TEST] Your parking session ends soon",
      html: endingReminderHtml(sampleReminder),
    });
    results.reminder = "sent";
  } catch (err) {
    results.reminder = "failed: " + err.message;
  }

  return res.status(200).json(results);
}
