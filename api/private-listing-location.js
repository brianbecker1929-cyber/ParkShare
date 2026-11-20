// Authenticated exact-address access. Listing IDs alone are NOT credentials.
import { jsonMethod, requireUser, supabaseAdmin } from "./_lib.js";
import { validId, canReadPreciseLocation } from "../src/lib/privateListingAccess.js";

export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;
  const user = await requireUser(req, res);
  if (!user) return;
  const listingId = validId(req.query?.listingId);
  const bookingId = req.query?.bookingId ? validId(req.query.bookingId) : null;
  if (!listingId || (req.query?.bookingId && !bookingId)) {
    return res.status(400).json({ error: "Valid listing and booking IDs required." });
  }
  try {
    const { data: listing, error } = await supabaseAdmin.from("listings")
      .select("id,host_id,address,lat,lng,title,spots,spaces,description,price")
      .eq("id", listingId).maybeSingle();
    if (error) throw error;
    if (!listing) return res.status(404).json({ error: "Listing unavailable." });
    let booking = null;
    if (bookingId && user.id !== listing.host_id) {
      const result = await supabaseAdmin.from("bookings")
        .select("id,renter_id,listing_id,status,paid_at,stripe_checkout_session_id")
        .eq("id", bookingId).maybeSingle();
      if (result.error) throw result.error;
      booking = result.data;
    }
    if (!canReadPreciseLocation({ userId: user.id, hostId: listing.host_id, booking, listingId })) {
      return res.status(404).json({ error: "Listing unavailable." });
    }
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ listing: {
      id: listing.id, title: listing.title, address: listing.address,
      lat: listing.lat, lng: listing.lng, price: Number(listing.price),
      spaces: listing.spaces, spots: listing.spots || [], description: listing.description || "",
    } });
  } catch (err) {
    console.error("[private-listing-location]", { code: err?.code });
    return res.status(503).json({ error: "Listing information temporarily unavailable." });
  }
}
