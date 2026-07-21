// POST /api/stripe-webhook
// Configure this endpoint in Stripe to receive BOTH platform events and
// events from connected accounts. Direct-charge events include event.account.

import { stripe, supabaseAdmin } from "./_lib.js";

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function syncConnectedAccount(account) {
  const requirementsDue = [
    ...(account.requirements?.currently_due || []),
    ...(account.requirements?.past_due || []),
  ];
  const complete = Boolean(account.details_submitted && account.charges_enabled && account.payouts_enabled);

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      stripe_onboarding_complete: complete,
      stripe_charges_enabled: Boolean(account.charges_enabled),
      stripe_payouts_enabled: Boolean(account.payouts_enabled),
      stripe_requirements_due: [...new Set(requirementsDue)],
    })
    .eq("stripe_account_id", account.id);
  if (error) throw error;
}

async function confirmBooking(session, connectedAccountId) {
  if (session.payment_status !== "paid") return;
  const metadata = session.metadata || {};
  const listingId = Number(metadata.listing_id);
  const hours = Number(metadata.hours);
  const totalCents = Number(metadata.total_cents);
  if (!Number.isInteger(listingId) || !metadata.renter_id || !Number.isFinite(hours) || !Number.isFinite(totalCents)) {
    throw new Error("Checkout Session is missing required ParkShare metadata.");
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  let chargeId = null;
  if (paymentIntentId && connectedAccountId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: connectedAccountId });
    chargeId = typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id || null;
  }

  const row = {
    listing_id: listingId,
    renter_id: metadata.renter_id,
    hours,
    total: totalCents / 100,
    subtotal: Number(metadata.subtotal_cents || 0) / 100,
    service_fee: Number(metadata.service_fee_cents || 0) / 100,
    status: "confirmed",
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: chargeId,
    stripe_connected_account_id: connectedAccountId || null,
    spot_label: metadata.spot_label || null,
    booking_date: metadata.booking_date || null,
    start_hour: metadata.start_hour === "" ? null : Number(metadata.start_hour),
    end_hour: metadata.end_hour === "" ? null : Number(metadata.end_hour),
    paid_at: new Date().toISOString(),
  };

  // Upsert makes webhook retries safe.
  const { error } = await supabaseAdmin
    .from("bookings")
    .upsert(row, { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true });
  if (error) throw error;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method not allowed");
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await confirmBooking(event.data.object, event.account || null);
        break;

      case "checkout.session.async_payment_failed": {
        const session = event.data.object;
        await supabaseAdmin
          .from("bookings")
          .update({ status: "payment_failed" })
          .eq("stripe_checkout_session_id", session.id);
        break;
      }

      case "account.updated":
        await syncConnectedAccount(event.data.object);
        break;

      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (paymentIntentId) {
          await supabaseAdmin
            .from("bookings")
            .update({ status: charge.refunded ? "refunded" : "partially_refunded" })
            .eq("stripe_payment_intent_id", paymentIntentId);
        }
        break;
      }

      case "charge.dispute.created": {
        const dispute = event.data.object;
        const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
        if (chargeId) {
          await supabaseAdmin
            .from("bookings")
            .update({ status: "disputed" })
            .eq("stripe_charge_id", chargeId);
        }
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error(`Webhook handler failed for ${event.type}:`, error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}
