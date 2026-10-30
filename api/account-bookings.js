// GET /api/account-bookings?view=driver|host
// Only the current JWT principal's reservations/listings leave the server.
// Never use a client-provided user ID to authorize a query.
import { jsonMethod, requireUser, supabaseAdmin } from "./_lib.js";
import { privateBookingListing, canReadPreciseLocation, canReadCancelledBookingTitle } from "../src/lib/privateListingAccess.js";
import { withBookingChargeTotals } from "./_booking-display-total.js";

const bookingColumns = [
  "id","listing_id","renter_id","hours","total","status","paid_at","application_state",
  // Keep the canonical instant/zone through the privacy-safe projection:
  // omitting them makes both dashboards reinterpret Toronto local time as UTC.
  "booking_date","start_hour","scheduled_starts_at","property_time_zone",
  "spot_label","vehicle_make","vehicle_model",
  "vehicle_colour","license_plate","refund_status","created_at",
  "cancellation_requested_at","refund_total_amount","refund_pending_amount",
  "event_id","event_name","event_category","event_venue_name","event_address",
  "event_lat","event_lng","event_starts_at","event_ends_at","event_timezone",
  "event_source","event_source_url","event_access_notes","event_closure_notice",
  "stripe_checkout_session_id",
].join(",");

const listingColumns = "id,host_id,title,address,price,description,features,spaces,spots,lat,lng";

function publicBookingShape(row, listing, participantName, fullLocation, historicalTitle = false) {
  const { stripe_checkout_session_id, ...safeBooking } = row;
  return {
    ...safeBooking,
    listings: privateBookingListing({ ...listing, profiles: { name: participantName } }, fullLocation, historicalTitle),
    profiles: { name: participantName || "Driver" },
  };
}

export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;
  const user = await requireUser(req, res);
  if (!user) return;
  const view = req.query?.view;
  if (view !== "driver" && view !== "host") return res.status(400).json({ error: "Invalid view." });
  try {
    if (view === "driver") {
      const { data, error } = await supabaseAdmin.from("bookings").select(bookingColumns)
        .eq("renter_id", user.id).order("created_at", { ascending: false }).limit(250);
      if (error) throw error;
      // Rejected checkouts are financial audits in Transactions, not reservations.
      const rows = await withBookingChargeTotals(supabaseAdmin, (data || []).filter(b => b.application_state !== "rejected"));
      const ids = [...new Set(rows.map(b => b.listing_id))];
      let listings = [];
      if (ids.length) {
        const result = await supabaseAdmin.from("listings")
          .select(listingColumns).in("id", ids);
        if (result.error) throw result.error;
        listings = result.data || [];
      }
      const byId = new Map(listings.map(l => [Number(l.id), l]));
      // Only project names for legitimate booking relationships.
      const hostIds = [...new Set(listings.map(l => l.host_id).filter(Boolean))];
      let people = [];
      if (hostIds.length) {
        const result = await supabaseAdmin.from("profiles").select("id,name").in("id", hostIds);
        if (result.error) throw result.error;
        people = result.data || [];
      }
      const names = new Map(people.map(p => [p.id, p.name]));
      const bookings = rows.map(b => {
        const l = byId.get(Number(b.listing_id));
        const precise = l && canReadPreciseLocation({
          userId: user.id, hostId: l.host_id, listingId: l.id, booking: b,
        });
        const historicalTitle = l && canReadCancelledBookingTitle({
          userId: user.id, listingId: l.id, booking: b,
        });
        return publicBookingShape(b, l, precise ? names.get(l?.host_id) : "Host", precise, historicalTitle);
      });
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json({ bookings });
    }

    const listResult = await supabaseAdmin.from("listings")
      .select(listingColumns).eq("host_id", user.id).limit(250);
    if (listResult.error) throw listResult.error;
    const listings = listResult.data || [];
    const ids = listings.map(l => l.id);
    if (!ids.length) return res.status(200).json({ listings: [], bookings: [], reviews: [] });
    const [booked, reviewed] = await Promise.all([
      supabaseAdmin.from("bookings").select(bookingColumns)
        .in("listing_id", ids).order("created_at", { ascending: false }).limit(500),
      supabaseAdmin.from("reviews")
        .select("id,listing_id,user_id,rating,text,created_at")
        .in("listing_id", ids).order("created_at", { ascending: false }).limit(500),
    ]);
    if (booked.error) throw booked.error;
    if (reviewed.error) throw reviewed.error;
    const reservationRows = await withBookingChargeTotals(supabaseAdmin, (booked.data || []).filter(b => b.application_state !== "rejected"));
    const renterIds = [...new Set([...reservationRows.map(b => b.renter_id),
      ...(reviewed.data || []).map(r => r.user_id)].filter(Boolean))];
    let people = [];
    if (renterIds.length) {
      const result = await supabaseAdmin.from("profiles").select("id,name").in("id", renterIds);
      if (result.error) throw result.error;
      people = result.data || [];
    }
    const names = new Map(people.map(p => [p.id, p.name]));
    const byId = new Map(listings.map(l => [Number(l.id), l]));
    const bookings = reservationRows.map(b => publicBookingShape(
      b, byId.get(Number(b.listing_id)), names.get(b.renter_id) || "Driver", true,
    ));
    const reviews = (reviewed.data || []).map(r => ({
      id: r.id, listing_id: r.listing_id, rating: r.rating, text: r.text,
      created_at: r.created_at, profiles: { name: names.get(r.user_id) || "Driver" },
    }));
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ listings, bookings, reviews });
  } catch (error) {
    console.error("[account-bookings]", { code: error?.code });
    return res.status(503).json({ error: "Your parking account details are temporarily unavailable." });
  }
}

