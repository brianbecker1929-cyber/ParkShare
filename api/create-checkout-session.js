// Vercel serverless function — POST /api/create-checkout-session
// Creates a Stripe-hosted Checkout session for a driveway booking.
// The actual card entry happens on Stripe's page, never in our app,
// so we never touch raw card numbers (keeps us out of PCI scope).

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { listingId, renterId, hours, total, listingTitle, spotLabel } = req.body;

    if (!listingId || !renterId || !hours || !total) {
      return res.status(400).json({ error: "Missing required booking fields" });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(Number(total) * 100),
            product_data: {
              name: listingTitle || "ParkShare driveway booking",
              description: hours + " hour" + (hours === 1 ? "" : "s") + (spotLabel ? " · Spot " + spotLabel : ""),
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        listing_id: String(listingId),
        renter_id: String(renterId),
        hours: String(hours),
        total: String(total),
      },
      success_url: origin + "/?booking_success=1",
      cancel_url: origin + "/?booking_cancelled=1",
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: err.message || "Something went wrong" });
  }
}
