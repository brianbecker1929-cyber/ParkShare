// Authenticated written reviews share the existing private-location boundary:
// free text can contain a residential address or access instructions.
import { supabaseAdmin, jsonMethod, requireUser } from "./_lib.js";
import { validId, canReadPreciseLocation } from "../src/lib/privateListingAccess.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Authorization");
  if (!jsonMethod(req, res, "GET")) return;
  const listingId = validId(req.query?.listingId);
  if (!listingId) return res.status(400).json({ error: "Invalid listing ID." });
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const { data: listing, error: listingError } = await supabaseAdmin.from("listings")
      .select("id,host_id").eq("id", listingId).maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return res.status(404).json({ error: "Listing unavailable." });
    let booking = null;
    if (user.id !== listing.host_id) {
      const result = await supabaseAdmin.from("bookings")
        .select("renter_id,listing_id,status,paid_at,stripe_checkout_session_id")
        .eq("renter_id", user.id).eq("listing_id", listingId)
        .in("status", ["confirmed", "completed"]).not("paid_at", "is", null)
        .not("stripe_checkout_session_id", "is", null).limit(1).maybeSingle();
      if (result.error) throw result.error;
      booking = result.data;
    }
    const textAvailable = canReadPreciseLocation({ userId: user.id, hostId: listing.host_id, booking, listingId });
    const { data, error } = await supabaseAdmin.from("reviews")
      .select(textAvailable ? "rating,created_at,text" : "rating,created_at")
      .eq("listing_id", listingId).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return res.status(200).json({ textAvailable, reviews: (data || []).map(row => ({
      user: "ParkShare driver", rating: row.rating,
      date: row.created_at ? new Date(row.created_at).toLocaleDateString("en-CA", { year: "numeric", month: "short", timeZone: "UTC" }) : "",
      text: textAvailable && typeof row.text === "string" ? row.text : "",
    })) });
  } catch (error) {
    console.error("[listing-reviews]", { code: error?.code });
    return res.status(503).json({ error: "Reviews are temporarily unavailable." });
  }
}
