// POST /api/create-checkout-session
// Creates a direct charge on the Host's connected Stripe account. ParkShare's
// service fee is collected as an application fee.

import { getOrigin, jsonMethod, requireUser, stripe, supabaseAdmin } from "./_lib.js";

const SERVICE_FEE_RATE = 0.12;
const MAX_HOURS = 24 * 31;

export default async function handler(req, res) {
  if (!jsonMethod(req, res)) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const listingId = Number(req.body?.listingId);
    const hours = Number(req.body?.hours);
    const spotLabel = req.body?.spotLabel ? String(req.body.spotLabel).slice(0, 20) : "";
    const bookingDate = req.body?.bookingDate ? String(req.body.bookingDate).slice(0, 40) : "";
    const startHour = Number.isFinite(Number(req.body?.startHour)) ? Number(req.body.startHour) : null;
    const endHour = Number.isFinite(Number(req.body?.endHour)) ? Number(req.body.endHour) : null;

    if (!Number.isInteger(listingId) || !Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
      return res.status(400).json({ error: "Invalid listing or booking duration." });
    }

    const { data: listing, error: listingError } = await supabaseAdmin
      .from("listings")
      .select("id, host_id, title, address, price")
      .eq("id", listingId)
      .single();

    if (listingError || !listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.host_id === user.id) return res.status(400).json({ error: "Hosts can't book their own listing." });

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

    // All amounts are calculated server-side from the database price.
    const hourlyCents = Math.round(Number(listing.price) * 100);
    const subtotalCents = Math.round(hourlyCents * hours);
    const serviceFeeCents = Math.round(subtotalCents * SERVICE_FEE_RATE);
    const totalCents = subtotalCents + serviceFeeCents;
    if (hourlyCents < 50 || totalCents < 50) return res.status(400).json({ error: "Booking amount is too small." });

    const origin = getOrigin(req);
    const metadata = {
      listing_id: String(listing.id),
      renter_id: String(user.id),
      host_id: String(listing.host_id),
      hours: String(hours),
      subtotal_cents: String(subtotalCents),
      service_fee_cents: String(serviceFeeCents),
      total_cents: String(totalCents),
      spot_label: spotLabel,
      booking_date: bookingDate,
      start_hour: startHour === null ? "" : String(startHour),
      end_hour: endHour === null ? "" : String(endHour),
    };

    const session = await stripe.checkout.sessions.create(
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
                description: `${hours} hour${hours === 1 ? "" : "s"}${spotLabel ? ` · Spot ${spotLabel}` : ""}`,
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
        cancel_url: `${origin}/?booking_cancelled=1`,
      },
      { stripeAccount: stripeAccountId }
    );

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("create-checkout-session error:", error);
    return res.status(500).json({ error: error.message || "Unable to start checkout." });
  }
}
