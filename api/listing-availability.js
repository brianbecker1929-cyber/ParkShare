
// GET /api/listing-availability?listingId=123&hours=1
//   or  ?listingId=123&hours=2&bookingDate=2026-07-25&startHour=14
//
// Public, no auth required — this powers both:
//   - the "X spots available now" badge while browsing (no bookingDate/startHour)
//   - the live check tied to a specific future date/time when scheduling an
//     advance booking (bookingDate + startHour provided)
//
// Reuses getSessionWindow — the exact same window logic used to enforce
// availability at checkout (create-checkout-session.js) and to time
// reminder emails (send-reminders.js) — so "what this badge shows you" and
// "what actually gets enforced when you pay" can never drift apart.

import { supabaseAdmin, checkAvailability, checkAllSpotAvailability, jsonMethod, getSessionWindow } from "./_lib.js";

export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;

  const listingId = Number(req.query?.listingId);
  const hours = Number(req.query?.hours) || 1;
  const bookingDate = req.query?.bookingDate ? String(req.query.bookingDate).slice(0, 40) : "";
  const startHour = req.query?.startHour !== undefined && req.query.startHour !== ""
    ? Number(req.query.startHour)
    : null;

  if (!Number.isInteger(listingId)) {
    return res.status(400).json({ error: "Missing or invalid listingId." });
  }

  try {
    const { data: listing, error } = await supabaseAdmin
      .from("listings")
      .select("id, spaces")
      .eq("id", listingId)
      .single();
    if (error || !listing) return res.status(404).json({ error: "Listing not found." });

    // No bookingDate/startHour -> same as before: window starts right now.
    // With them -> checks that specific future window instead, so scheduling
    // a slot shows real availability for THAT time, not just "now."
    const { start, end } = getSessionWindow({
      paid_at: new Date().toISOString(),
      booking_date: bookingDate,
      start_hour: startHour,
      hours,
    });

    const result = await checkAvailability(listingId, listing.spaces || 1, start, end);

    // Per-letter status for the picker UI — same window, same "confirmed
    // bookings only" rule as the capacity check above, just broken out by
    // spot_label instead of summed into one count. Hardcoded to A-D since
    // that's the fixed 4-slot layout SpotPicker in App.jsx renders today;
    // revisit both together if that ever supports more than 4 spots.
    const spotStatus = await checkAllSpotAvailability(listingId, ["A", "B", "C", "D"], start, end);

    return res.status(200).json({ ...result, spotStatus });
  } catch (err) {
    console.error("listing-availability error:", err);
    return res.status(500).json({ error: "Couldn't check availability." });
  }
}
