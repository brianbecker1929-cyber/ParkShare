// GET /api/listing-availability?listingId=123&hours=1
//   or  ?listingId=123&hours=2&bookingDate=2026-07-25&startHour=14
//
// Public, no auth required. Checks both Host-defined schedule rules and
// overlapping confirmed bookings/holds for the requested time window.

import { supabaseAdmin, checkAvailability, checkAllSpotAvailability, jsonMethod, getSessionWindow } from "./_lib.js";
import { isListingAvailableForWindow } from "../src/lib/listingAvailability.js";

function rentableSpotLabels(listing) {
  if (Array.isArray(listing.spots) && listing.spots.length > 0) {
    return listing.spots
      .map((spot, index) => spot?.forRent ? String.fromCharCode(65 + index) : null)
      .filter(Boolean);
  }
  const count = Math.max(1, Math.min(8, Number(listing.spaces) || 1));
  return Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
}

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
      .select("id, spaces, spots, availability")
      .eq("id", listingId)
      .single();
    if (error || !listing) return res.status(404).json({ error: "Listing not found." });

    const { start, end } = getSessionWindow({
      paid_at: new Date().toISOString(),
      booking_date: bookingDate,
      start_hour: startHour,
      hours,
    });

    const labels = rentableSpotLabels(listing);
    const hostScheduleOpen = isListingAvailableForWindow(listing.availability, start, end);
    if (!hostScheduleOpen) {
      const spotStatus = Object.fromEntries(labels.map(label => [label, false]));
      return res.status(200).json({
        available: false,
        spacesTotal: Math.max(1, Number(listing.spaces) || labels.length || 1),
        spacesFree: 0,
        hostScheduleOpen: false,
        reason: "host_schedule",
        spotStatus,
      });
    }

    const result = await checkAvailability(listingId, listing.spaces || 1, start, end);
    const spotStatus = await checkAllSpotAvailability(listingId, labels, start, end);

    return res.status(200).json({ ...result, hostScheduleOpen: true, spotStatus });
  } catch (err) {
    console.error("listing-availability error:", err);
    return res.status(500).json({ error: "Couldn't check availability." });
  }
}
