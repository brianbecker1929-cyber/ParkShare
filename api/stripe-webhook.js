// Vercel serverless function — POST /api/stripe-webhook
// Stripe calls this after a checkout session finishes. We verify the
// signature, then — only once payment is actually confirmed — write the
// booking row to Supabase using the service role key (this runs server-side
// with no logged-in user, so it must bypass row-level security).

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Stripe requires the raw request body to verify the webhook signature,
// so we turn off Vercel's automatic body parsing for this route.
export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method not allowed");
  }

  const sig = req.headers["stripe-signature"];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send("Webhook Error: " + err.message);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { listing_id, renter_id, hours, total } = session.metadata || {};

    if (listing_id && renter_id && hours && total) {
      const { error } = await supabaseAdmin.from("bookings").insert({
        listing_id: Number(listing_id),
        renter_id,
        hours: Number(hours),
        total: Number(total),
        status: "confirmed",
      });
      if (error) console.error("Failed to write booking after payment:", error);
    } else {
      console.error("checkout.session.completed missing expected metadata", session.metadata);
    }
  }

  return res.status(200).json({ received: true });
}
