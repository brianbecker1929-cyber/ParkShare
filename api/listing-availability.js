// GET /api/listing-availability?listingId=123&hours=1
//
// Public, no auth required — this powers the "X spots available now" badge
// while browsing, so it needs to work for signed-out visitors too. Returns
// live capacity for the window starting right now (real-time booking).
//
// This does NOT need a bookingDate/startHour variant yet, since nothing in
// the app can create an advance booking today — add one here if/when that
// UI exists, mirroring the same window logic used in
// create-checkout-session.js.

import { supabaseAdmin, checkAvailability, jsonMethod } from "./_lib.js";

export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;

  const listingId = Number(req.query?.listingId);
  const hours = Number(req.query?.hours) || 1;

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

    const start = new Date();
    const end = new Date(start.getTime() + hours * 3600 * 1000);

    const result = await checkAvailability(listingId, listing.spaces || 1, start, end);
    return res.status(200).json(result);
  } catch (err) {
    console.error("listing-availability error:", err);
    return res.status(500).json({ error: "Couldn't check availability." });
  }
}
