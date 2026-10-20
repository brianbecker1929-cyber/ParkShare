// POST /api/reviews — one verified review per Driver/listing.
// All writes occur server-side using the authenticated principal.
import { jsonMethod, requireUser, supabaseAdmin } from "./_lib.js";
import { eligibleForReview, validateReviewInput } from "./_review-rules.js";

export default async function handler(req, res) {
  if (!jsonMethod(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;
  const listingId = Number(req.body?.listingId);
  const rating = Number(req.body?.rating);
  const reviewText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const validation = validateReviewInput({ listingId, rating, text: reviewText });
  if (validation) return res.status(400).json({ error: validation });
  try {
    // A Host must not submit a self-rating, even after a paid test booking.
    // Confirm the target listing actually exists before checking eligibility.
    const { data: listing, error: listingError } = await supabaseAdmin
      .from("listings").select("id,host_id")
      .eq("id", listingId).maybeSingle();
    if (listingError) throw listingError;
    if (!listing) return res.status(404).json({ error: "Parking listing not found." });
    if (listing.host_id === user.id) {
      return res.status(403).json({ error: "Hosts cannot review their own parking listing." });
    }

    const { data: reservations, error: bookingError } = await supabaseAdmin
      .from("bookings")
      // Completion follows the immutable booking instant, not local hours
      // reinterpreted as UTC (which can permit early or delay valid reviews).
      .select("id,listing_id,renter_id,status,paid_at,stripe_checkout_session_id,booking_date,start_hour,scheduled_starts_at,property_time_zone,hours")
      .eq("listing_id", listingId).eq("renter_id", user.id)
      .not("paid_at", "is", null).limit(200);
    if (bookingError) throw bookingError;
    if (!(reservations || []).some(b => eligibleForReview(b))) {
      return res.status(403).json({
        error: "Only Drivers who completed a paid parking session here can leave a review."
      });
    }

    const { data: inserted, error: insertError } = await supabaseAdmin.from("reviews")
      .insert({ listing_id: listingId, user_id: user.id, rating, text: reviewText })
      .select("id,listing_id,rating,created_at").single();
    if (insertError?.code === "23505") return res.status(409).json({
      error: "You've already reviewed this parking listing."
    });
    if (insertError) throw insertError;
    res.setHeader("Cache-Control", "no-store");
    return res.status(201).json({ review: inserted });
  } catch (error) {
    console.error("[verified-reviews] unable to submit review", { code: error?.code });
    return res.status(503).json({ error: "Unable to submit your review. Try again later." });
  }
}
