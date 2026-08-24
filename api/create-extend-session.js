// POST /api/create-extend-session
// Extends an in-progress booking through Stripe Checkout.

import { checkAvailability, checkSpotAvailability, getOrigin, getSessionWindow, jsonMethod, requireUser, stripe, supabaseAdmin } from "./_lib.js";

const SERVICE_FEE_RATE = 0.15;

export default async function handler(req, res) {
  if (!jsonMethod(req, res)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const bookingId = Number(req.body?.bookingId);
    const addedHours = Number(req.body?.addedHours);
    if (!Number.isInteger(bookingId) || !Number.isFinite(addedHours) || addedHours <= 0 || addedHours > 24) {
      return res.status(400).json({ error: "Invalid booking or extension duration." });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id, listing_id, renter_id, hours, status, paid_at, booking_date, start_hour, spot_label")
      .eq("id", bookingId)
      .single();
    if (bookingError || !booking) return res.status(404).json({ error: "Booking not found." });
    if (booking.renter_id !== user.id) return res.status(403).json({ error: "You can only extend your own booking." });
    if (booking.status !== "confirmed") return res.status(409).json({ error: "Only a confirmed booking can be extended." });

    const current = getSessionWindow(booking);
    const now = Date.now();
    if (now < current.start.getTime() || now >= current.end.getTime()) {
      return res.status(409).json({ error: "Additional time is available only while the parking session is active." });
    }

    const { data: listing, error: listingError } = await supabaseAdmin
      .from("listings")
      .select("id, host_id, title, price, spaces")
      .eq("id", booking.listing_id)
      .single();
    if (listingError || !listing) return res.status(404).json({ error: "Listing not found." });
    const extendedEnd = new Date(current.end.getTime() + addedHours * 3600 * 1000);
    const capacity = await checkAvailability(listing.id, listing.spaces || 1, current.end, extendedEnd);
    if (!capacity.available) return res.status(409).json({ error: "The space is not available for that additional time." });
    if (booking.spot_label) {
      const spot = await checkSpotAvailability(listing.id, booking.spot_label, current.end, extendedEnd);
      if (!spot.available) return res.status(409).json({ error: `Spot ${spot.spotLabel} is not available for that additional time.` });
    }

    const { data: host } = await supabaseAdmin.from("profiles").select("stripe_account_id").eq("id", listing.host_id).single();
    if (!host?.stripe_account_id) return res.status(409).json({ error: "This Host has not finished setting up payouts yet." });
    const account = await stripe.accounts.retrieve(host.stripe_account_id);
    if (!account.charges_enabled) return res.status(409).json({ error: "This Host is not ready to accept payments." });

    const subtotalCents = Math.round(Number(listing.price) * 100 * addedHours);
    const serviceFeeCents = Math.round(subtotalCents * SERVICE_FEE_RATE);
    const totalCents = subtotalCents + serviceFeeCents;
    if (subtotalCents < 50) return res.status(400).json({ error: "Extension amount is too small." });
    const metadata = { type: "extension", booking_id: String(booking.id), added_hours: String(addedHours), total_cents: String(totalCents) };
    const origin = getOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email || undefined,
      line_items: [
        { price_data: { currency: "cad", unit_amount: subtotalCents, product_data: { name: `Additional time — ${listing.title}`, description: `${addedHours} additional hour${addedHours === 1 ? "" : "s"}` } }, quantity: 1 },
        ...(serviceFeeCents > 0 ? [{ price_data: { currency: "cad", unit_amount: serviceFeeCents, product_data: { name: "ParkShare service fee" } }, quantity: 1 }] : []),
      ],
      payment_intent_data: { application_fee_amount: serviceFeeCents, metadata },
      metadata,
      success_url: `${origin}/?extension_success=1`,
      cancel_url: `${origin}/?extension_cancelled=1&extend_booking=${booking.id}`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    }, { stripeAccount: host.stripe_account_id });
    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("create-extend-session error:", error);
    return res.status(500).json({ error: error.message || "Unable to start extension checkout." });
  }
}
