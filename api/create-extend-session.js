import {CAD_CHECKOUT_API_VERSION, requireCadCheckout} from "./_checkout-currency.js";
// POST /api/create-extend-session
// Extends an in-progress booking through Stripe Checkout.

import { checkAvailability, checkSpotAvailability, getOrigin, getSessionWindow, jsonMethod, requireUser, stripe, supabaseAdmin } from "./_lib.js";
import { validExtensionHours } from "./_extension-safety.js";

const SERVICE_FEE_RATE = 0.15;

export default async function handler(req, res) {
  if (!jsonMethod(req, res)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const bookingId = Number(req.body?.bookingId);
    const addedHours = Number(req.body?.addedHours);
    if (!Number.isInteger(bookingId) || !validExtensionHours(addedHours)) {
      return res.status(400).json({ error: "Invalid booking or extension duration." });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      // The active-session and availability checks must use the saved instant,
      // exactly as the database extension hold and booking dashboards do.
      .select("id, listing_id, renter_id, hours, status, paid_at, booking_date, start_hour, scheduled_starts_at, property_time_zone, spot_label")
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
    // Reserve the exact additional interval AT CHECKOUT, not only after
    // payment. Postgres reads the canonical booking end with full timestamp
    // precision and calls create_booking_hold under the listing advisory lock,
    // so no JavaScript Date rounding gap can produce a false conflict.
    // Stripe requires >=30 minutes until expiry; 30m45s also fits the DB's
    // 31-minute maximum checkout-hold lease.
    const holdExpiresAt = new Date(Date.now() + 30 * 60 * 1000 + 45 * 1000);
    const { data: reservedRows, error: holdError } = await supabaseAdmin.rpc("reserve_extension_checkout_hold", {
      p_booking_id: booking.id,
      p_renter_id: user.id,
      p_added_hours: addedHours,
      p_expires_at: holdExpiresAt.toISOString(),
    });
    if (holdError?.code === "P0001") {
      return res.status(409).json({ error: "That additional parking time is already booked or held. Please choose another time." });
    }
    // PR #167's per-Driver checkout quotas apply to the shared hold RPC.
    // Return a meaningful rate-limit response BEFORE Stripe Checkout begins.
    if (holdError?.code === "P0058") {
      return res.status(429).json({ error: "Too many active parking checkouts. Please try again later." });
    }
    if (holdError) throw holdError;
    const reserved = Array.isArray(reservedRows) ? reservedRows[0] : reservedRows;
    const holdId = reserved?.hold_id;
    if (!holdId || !reserved?.starts_at || !reserved?.ends_at) {
      throw new Error("Unable to reserve additional time.");
    }

    let session;
    try {
      const origin = getOrigin(req);
      session = await stripe.checkout.sessions.create({
      mode: "payment",
        adaptive_pricing: { enabled: false },
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
      expires_at: Math.floor(holdExpiresAt.getTime() / 1000),
    }, { stripeAccount: host.stripe_account_id, apiVersion: CAD_CHECKOUT_API_VERSION });
      requireCadCheckout(session, totalCents);

      // Bind trusted hold evidence to the exact Stripe Checkout session.
      // A paid webhook will reject a missing/mismatched hold before changing
      // the booking. The client never provides a trusted hold identifier.
      const { data: boundHold, error: bindError } = await supabaseAdmin
        .from("booking_holds")
        .update({ stripe_checkout_session_id: session.id, expected_connected_account_id: host.stripe_account_id, expected_total_cents: totalCents })
        .eq("id", holdId)
        .eq("listing_id", listing.id)
        .eq("renter_id", user.id)
        .is("stripe_checkout_session_id", null)
        .select("id")
        .maybeSingle();
      if (bindError || !boundHold) {
        throw bindError || new Error("Unable to bind reserved time to secure checkout.");
      }

      const { data: pending, error: pendingError } = await supabaseAdmin
        .from("pending_booking_extensions")
        .insert({
          booking_id: booking.id,
          renter_id: user.id,
          added_hours: addedHours,
          expected_total_cents: totalCents,
          expected_service_fee_cents: serviceFeeCents,
          expected_connected_account_id: host.stripe_account_id,
          stripe_checkout_session_id: session.id,
          hold_id: holdId,
        })
        .select("id")
        .maybeSingle();
      if (pendingError || !pending) {
        throw pendingError || new Error("Unable to register a secure booking extension.");
      }
      return res.status(200).json({ url: session.url });
    } catch (checkoutError) {
      // Never strand a 30-minute parking hold when Stripe setup or secure
      // registration fails. Checkout URL was not delivered to the Driver.
      if (session?.id) {
        await stripe.checkout.sessions.expire(session.id, {}, {
          stripeAccount: host.stripe_account_id,
        }).catch(error => console.error("Could not expire orphan extension checkout:", error));
        const { error: deletePendingError } = await supabaseAdmin
          .from("pending_booking_extensions").delete()
          .eq("stripe_checkout_session_id", session.id);
        if (deletePendingError) console.error("Extension pending cleanup failed:", deletePendingError);
      }
      const { error: releaseError } = await supabaseAdmin
        .from("booking_holds").delete()
        .eq("id", holdId)
        .eq("listing_id", listing.id)
        .eq("renter_id", user.id);
      if (releaseError) console.error("Extension hold cleanup failed:", releaseError);
      throw checkoutError;
    }
  } catch (error) {
    console.error("create-extend-session error:", error);
    return res.status(500).json({ error: error.message || "Unable to start extension checkout." });
  }
}
