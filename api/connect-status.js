// GET /api/connect-status
// Returns only the connected-account readiness fields the ParkShare UI needs.

import { jsonMethod, requireUser, stripe, supabaseAdmin } from "./_lib.js";

export default async function handler(req, res) {
  if (!jsonMethod(req, res, "GET")) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("role, stripe_account_id")
      .eq("id", user.id)
      .single();

    if (error || !profile) return res.status(404).json({ error: "Profile not found." });
    if (profile.role !== "host") return res.status(403).json({ error: "Only Host accounts have payout status." });
    if (!profile.stripe_account_id) {
      return res.status(200).json({ connected: false, onboardingComplete: false, chargesEnabled: false, payoutsEnabled: false, requirementsDue: [] });
    }

    const account = await stripe.accounts.retrieve(profile.stripe_account_id);
    const requirementsDue = [
      ...(account.requirements?.currently_due || []),
      ...(account.requirements?.past_due || []),
    ];
    const onboardingComplete = Boolean(account.details_submitted && account.charges_enabled && account.payouts_enabled);

    await supabaseAdmin
      .from("profiles")
      .update({
        stripe_onboarding_complete: onboardingComplete,
        stripe_charges_enabled: Boolean(account.charges_enabled),
        stripe_payouts_enabled: Boolean(account.payouts_enabled),
      })
      .eq("id", user.id);

    return res.status(200).json({
      connected: true,
      onboardingComplete,
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      requirementsDue: [...new Set(requirementsDue)],
    });
  } catch (error) {
    console.error("connect-status error:", error);
    return res.status(500).json({ error: error.message || "Unable to check payout status." });
  }
}
