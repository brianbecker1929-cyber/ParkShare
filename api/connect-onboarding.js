// POST /api/connect-onboarding
// Creates (or reuses) a Host connected account and returns a single-use
// Stripe-hosted onboarding URL. Never expose STRIPE_SECRET_KEY to the browser.

import { getOrigin, jsonMethod, requireUser, stripe, supabaseAdmin } from "./_lib.js";

export default async function handler(req, res) {
  if (!jsonMethod(req, res)) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, role, stripe_account_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) return res.status(404).json({ error: "Host profile not found." });
    if (profile.role !== "host") return res.status(403).json({ error: "Only Host accounts can set up payouts." });

    let accountId = profile.stripe_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "standard",
        country: "CA",
        email: profile.email || user.email,
        business_profile: {
          product_description: "Short-term parking spaces offered through the ParkShare marketplace",
          url: process.env.APP_URL || undefined,
        },
        metadata: {
          parkshare_user_id: user.id,
          parkshare_role: "host",
        },
      });
      accountId = account.id;

      const { error: saveError } = await supabaseAdmin
        .from("profiles")
        .update({ stripe_account_id: accountId })
        .eq("id", user.id);
      if (saveError) throw saveError;
    }

    const origin = getOrigin(req);
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/?stripe_onboarding=refresh`,
      return_url: `${origin}/?stripe_onboarding=return`,
      type: "account_onboarding",
      collection_options: { fields: "eventually_due" },
    });

    return res.status(200).json({ url: accountLink.url });
  } catch (error) {
    console.error("connect-onboarding error:", error);
    return res.status(500).json({ error: error.message || "Unable to start Stripe onboarding." });
  }
}
