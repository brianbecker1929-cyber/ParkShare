// POST /api/create-checkout-session
// Creates a direct charge on the Host's connected Stripe account. ParkShare's
// service fee is collected as an application fee.

import { getOrigin, jsonMethod, requireUser, stripe, supabaseAdmin, getSessionWindow } from "./_lib.js";
import { calculateBookingAmounts, isRentableSpot, isValidBookingDuration } from "./_booking-rules.js";
import { getBookableVehicles } from "../src/lib/driverProfile.js";
import { isListingAvailableForWindow } from "../src/lib/listingAvailability.js";
import { validateHourlyRate } from "../src/lib/listingPrice.js";
import { resolveLocalBookingStart } from "./_booking-local-time.js";

const SERVICE_FEE_RATE = 0.15;

export default async function handler(req, res) {
  if (!jsonMethod(req, res)) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    // Resolve the trusted redirect destination before creating Stripe resources
    // or database holds, so misconfiguration cannot leave orphaned side effects.
    const origin = getOrigin(req);

    const listingId = Number(req.body?.listingId);
    const hours = Number(req.body?.hours);
    const spotLabel = req.body?.spotLabel ? String(req.body.spotLabel).trim().toUpperCase().slice(0, 20) : "";
    const bookingDate = req.body?.bookingDate ? String(req.body.bookingDate).slice(0, 40) : "";
    const startHour = req.body?.startHour !== null && req.body?.startHour !== "" && Number.isFinite(Number(req.body?.startHour)) ? Number(req.body.startHour) : null;
    const endHour = req.body?.endHour !== null && req.body?.endHour !== "" && Number.isFinite(Number(req.body?.endHour)) ? Number(req.body.endHour) : null;
    const vehicleId = String(req.body?.vehicleId || "").slice(0, 64);
    const eventId = req.body?.eventId === undefined || req.body?.eventId === null || req.body?.eventId === ""
      ? null
      : Number(req.body.eventId);

    if (!Number.isInteger(listingId) || !isValidBookingDuration(hours, { scheduled: Boolean(bookingDate) })) {
      return res.status(400).json({ error: "Invalid listing or booking duration." });
    }
    if (eventId !== null && !Number.isInteger(eventId)) {
      return res.status(400).json({ error: "Invalid event selection." });
    }

    const userMetadata = user.user_metadata || {};
    const bookingVehicle = getBookableVehicles({
      vehicle_make: userMetadata.vehicle_make,
      vehicle_model: userMetadata.vehicle_model,
      vehicle_colour: userMetadata.vehicle_colour,
      license_plate: userMetadata.license_plate,
      guest_vehicles: userMetadata.guest_vehicles,
    }).find(vehicle => vehicle.id === vehicleId);
    if (!bookingVehicle) {
      return res.status(400).json({ error: "Save and select a complete booking vehicle before checkout." });
    }

    const { data: listing, error: listingError } = await supabaseAdmin
      .from("listings")
      .select("id, host_id, title, address, price, spaces, spots, availability, time_zone")
      .eq("id", listingId)
      .single();

    if (listingError || !listing) return res.status(404).json({ error: "Listing not found." });
    // Host rates may originate from historical rows or direct Supabase
    // writes. Never trust a form's min/max or silently coerce negative
    // prices before creating holds or any Stripe Checkout Session.
    const rate = validateHourlyRate(listing.price);
    if (!rate.valid) return res.status(409).json({
      error: "This parking space has an invalid hourly price. Please choose another listing or contact support.",
    });
    if (listing.host_id === user.id) return res.status(400).json({ error: "Hosts can't book their own listing." });
    if (!isRentableSpot(listing, spotLabel)) {
      return res.status(400).json({ error: "Please select a valid parking spot before checkout." });
    }

    let bookingEvent = null;
    if (eventId !== null) {
      const { data: eventRow, error: eventError } = await supabaseAdmin
        .from("events")
        .select("id, source, name, category, venue_name, address, lat, lng, starts_at, ends_at, timezone, status, source_url, access_notes, closure_notice")
        .eq("id", eventId)
        .eq("status", "published")
        .single();
      if (eventError || !eventRow) return res.status(404).json({ error: "This event is no longer available for parking search." });
      bookingEvent = eventRow;
    }

    // The property clock — never the Driver device/browser or UTC clock —
    // determines when a future reservation begins. The IANA time zone is
    // stored on the listing by a reviewed server-side geolocation backfill.
    // No silent Toronto fallback: if zone is unverified, fail closed.
    let scheduledStartsAt = null;
    if (bookingDate) {
      if (startHour === null || endHour === null ||
          Math.abs(endHour - startHour - hours) > 1e-9) {
        return res.status(400).json({ error: "Choose a valid scheduled parking window." });
      }
      if (!listing.time_zone) {
        return res.status(409).json({
          error: "This Host's property time zone must be verified before scheduled checkout. Please choose Park Now or contact support."
        });
      }
      try {
        scheduledStartsAt = resolveLocalBookingStart({
          bookingDate, startHour, timeZone: listing.time_zone,
        }).toISOString();
      } catch (error) {
        return res.status(400).json({ error: error.message || "Invalid property-local booking time." });
      }
      if (new Date(scheduledStartsAt).getTime() <= Date.now()) {
        return res.status(400).json({ error: "Scheduled parking must start in the future." });
      }
    } else if (startHour !== null || endHour !== null) {
      return res.status(400).json({ error: "Scheduled hours require a parking date." });
    }
    const { start: windowStart, end: windowEnd } = getSessionWindow({
      paid_at: new Date().toISOString(),
      booking_date: bookingDate,
      start_hour: startHour,
      scheduled_starts_at: scheduledStartsAt,
      hours,
    });

    // Host schedule is checked server-side immediately before any hold or
    // Stripe session is created. Existing confirmed bookings remain intact if
    // a Host later narrows their schedule; this only blocks NEW bookings.
    if (!isListingAvailableForWindow(listing.availability, windowStart, windowEnd, listing.time_zone)) {
      return res.status(409).json({ error: "This driveway is not available during that time. Please choose another time." });
    }

    const { data: hostProfile, error: hostError } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", listing.host_id)
      .single();
    if (hostError) throw hostError;

    const stripeAccountId = hostProfile?.stripe_account_id;
    if (!stripeAccountId) return res.status(409).json({ error: "This Host has not finished setting up payouts yet." });

    const account = await stripe.accounts.retrieve(stripeAccountId);
    if (!account.charges_enabled) {
      return res.status(409).json({ error: "This Host's Stripe account isn't ready to accept payments yet." });
    }

    const { hourlyCents, subtotalCents, serviceFeeCents, totalCents } = calculateBookingAmounts(
      rate.value,
      hours,
      SERVICE_FEE_RATE
    );
    if (![hourlyCents, subtotalCents, serviceFeeCents, totalCents].every(Number.isSafeInteger)
        || hourlyCents < 100 || subtotalCents <= 0 || totalCents < 100) {
      return res.status(409).json({ error: "This listing's booking price cannot be processed. Please contact support." });
    }

    const holdExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const { data: holdId, error: holdError } = await supabaseAdmin.rpc("create_booking_hold", {
      p_listing_id: listing.id,
      p_renter_id: user.id,
      p_spot_label: spotLabel || null,
      p_starts_at: windowStart.toISOString(),
      p_ends_at: windowEnd.toISOString(),
      p_expires_at: holdExpiresAt.toISOString(),
    });
    if (holdError) {
      // Database-enforced, serialized per-Driver quotas prevent repeated
      // unpaid Checkout starts, including concurrent requests to other
      // listings. Do not create any Stripe Session when over the limit.
      if (holdError.code === "P0058") {
        return res.status(429).json({
          error: "You've started several parking checkouts recently. Please try again later or contact ParkShare support.",
          code: "checkout_rate_limited",
        });
      }
      if (holdError.code === "P0001") {
        return res.status(409).json({ error: "This spot is currently booked or being held by another driver. Please choose a different spot or time." });
      }
      throw holdError;
    }

    const metadata = {
      listing_id: String(listing.id),
      renter_id: String(user.id),
      host_id: String(listing.host_id),
      connected_account_id: stripeAccountId,
      hours: String(hours),
      subtotal_cents: String(subtotalCents),
      service_fee_cents: String(serviceFeeCents),
      total_cents: String(totalCents),
      spot_label: spotLabel,
      booking_date: bookingDate,
      // The server-owned Checkout hold stores the authoritative interval.
      // Metadata is a snapshot and MUST NOT override the hold in a webhook.
      scheduled_starts_at: scheduledStartsAt || "",
      property_time_zone: listing.time_zone || "",
      start_hour: startHour === null ? "" : String(startHour),
      end_hour: endHour === null ? "" : String(endHour),
      hold_id: String(holdId),
      vehicle_id: bookingVehicle.id,
      vehicle_type: bookingVehicle.type,
      vehicle_make: bookingVehicle.vehicleMake,
      vehicle_model: bookingVehicle.vehicleModel,
      vehicle_colour: bookingVehicle.vehicleColour,
      license_plate: bookingVehicle.licensePlate,
      ...(bookingEvent ? {
        event_id: String(bookingEvent.id),
        event_name: String(bookingEvent.name || "").slice(0, 300),
        event_category: String(bookingEvent.category || "community").slice(0, 40),
        event_venue_name: String(bookingEvent.venue_name || "").slice(0, 300),
        event_address: String(bookingEvent.address || "").slice(0, 400),
        event_lat: String(bookingEvent.lat),
        event_lng: String(bookingEvent.lng),
        event_starts_at: String(bookingEvent.starts_at || ""),
        event_ends_at: String(bookingEvent.ends_at || ""),
        event_timezone: String(bookingEvent.timezone || "America/Toronto").slice(0, 100),
        event_source: String(bookingEvent.source || "ParkShare").slice(0, 100),
        event_source_url: String(bookingEvent.source_url || "").slice(0, 500),
        event_access_notes: String(bookingEvent.access_notes || "").slice(0, 500),
        event_closure_notice: String(bookingEvent.closure_notice || "").slice(0, 500),
      } : {}),
    };

    let session;
    try {
      session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: user.email || undefined,
        line_items: [
          {
            price_data: {
              currency: "cad",
              unit_amount: subtotalCents,
              product_data: {
                name: listing.title || "ParkShare parking booking",
                description: `${hours} hour${hours === 1 ? "" : "s"}${spotLabel ? ` · Spot ${spotLabel}` : ""}${bookingEvent ? ` · ${bookingEvent.name}` : ""}`.slice(0, 500),
              },
            },
            quantity: 1,
          },
          {
            price_data: {
              currency: "cad",
              unit_amount: serviceFeeCents,
              product_data: { name: "ParkShare service fee" },
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          application_fee_amount: serviceFeeCents,
          metadata,
        },
        metadata,
        success_url: `${origin}/?booking_success=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?booking_cancelled=1&checkout_hold=${encodeURIComponent(holdId)}`,
        expires_at: Math.floor(holdExpiresAt.getTime() / 1000),
      },
      { stripeAccount: stripeAccountId }
      );

      // Stripe metadata is not a source of truth: record the exact session,
      // connected Host and approved price in a service-role-only hold.
      const { data: registeredHold, error: saveSessionError } = await supabaseAdmin
        .from("booking_holds")
        .update({
          stripe_checkout_session_id: session.id,
          expected_total_cents: totalCents,
          expected_connected_account_id: stripeAccountId,
          checkout_metadata: metadata,
        })
        .eq("id", holdId)
        .select("id")
        .maybeSingle();
      if (saveSessionError || !registeredHold) {
        await stripe.checkout.sessions.expire(session.id, {}, { stripeAccount: stripeAccountId }).catch(() => {});
        throw saveSessionError || new Error("Unable to register a secure checkout hold.");
      }
    } catch (checkoutError) {
      await supabaseAdmin.from("booking_holds").delete().eq("id", holdId);
      throw checkoutError;
    }

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("create-checkout-session error:", error);
    return res.status(500).json({ error: error.message || "Unable to start checkout." });
  }
}
