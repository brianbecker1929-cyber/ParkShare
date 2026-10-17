// GET /api/listing-availability?listingId=123&hours=1
//   or  ?listingId=123&hours=2&bookingDate=2026-07-25&startHour=14
//
// Public, no auth required. Checks both Host-defined schedule rules and
// overlapping confirmed bookings/holds for the requested time window.

import { supabaseAdmin, checkAvailability, checkAllSpotAvailability, jsonMethod, getSessionWindow } from "./_lib.js";
import { isListingAvailableForWindow } from "../src/lib/listingAvailability.js";
import { resolveLocalBookingStart } from "./_booking-local-time.js";
import { isValidBookingDuration } from "./_booking-rules.js";

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
  const hours = req.query?.hours == null ? 1 : Number(req.query.hours);
  const bookingDate = req.query?.bookingDate ? String(req.query.bookingDate).slice(0, 40) : "";
  const startHour = req.query?.startHour !== undefined && req.query.startHour !== ""
    ? Number(req.query.startHour)
    : null;

  if (!Number.isSafeInteger(listingId) || listingId <= 0 || !isValidBookingDuration(hours, { scheduled: !!bookingDate })) {
    return res.status(400).json({ error: "Missing or invalid listingId." });
  }

  try {
    const { data: listing, error } = await supabaseAdmin
      .from("listings")
      .select("id, spaces, spots, availability, time_zone")
      .eq("id", listingId)
      .single();
    if (error || !listing) return res.status(404).json({ error: "Listing not found." });

    // Availability MUST use exactly the same property-local resolver as
    // checkout; otherwise a Driver may be offered the wrong parking interval.
    let scheduledStartsAt = null;
    if (bookingDate) {
      if (startHour === null) return res.status(400).json({ error: "Choose a start time." });
      if (!listing.time_zone) return res.status(409).json({
        error: "This driveway's time zone must be verified before future bookings can be checked."
      });
      try {
        scheduledStartsAt = resolveLocalBookingStart({
          bookingDate, startHour, timeZone: listing.time_zone,
        }).toISOString();
      } catch (error) {
        return res.status(400).json({ error: error.message || "Invalid scheduled time." });
      }
      if (new Date(scheduledStartsAt).getTime() <= Date.now()) {
        return res.status(400).json({ error: "Choose a future scheduled start." });
      }
    } else if (startHour !== null) {
      return res.status(400).json({ error: "Start hour requires a scheduled date." });
    }
    const { start, end } = getSessionWindow({
      paid_at: new Date().toISOString(),
      booking_date: bookingDate,
      start_hour: startHour,
      scheduled_starts_at: scheduledStartsAt,
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
