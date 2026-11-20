// Cancel only the caller's registered, still-unpaid initial Checkout.
// Stripe expiry wins the payment race before we release any inventory.
import { jsonMethod, requireUser, stripe, supabaseAdmin } from "./_lib.js";
import { verifyBookingHoldSnapshot } from "./_checkout-integrity.js";
import { isExpectedCheckoutTermination } from "./_checkout-terminal-safety.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!jsonMethod(req, res)) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const holdId = req.body?.holdId;
    if (typeof holdId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(holdId)) {
      return res.status(400).json({ error: "Invalid checkout reference." });
    }
    const { data: hold, error } = await supabaseAdmin.from("booking_holds")
      .select("id, listing_id, renter_id, starts_at, ends_at, spot_label, stripe_checkout_session_id, expected_connected_account_id, expected_total_cents, checkout_metadata")
      .eq("id", holdId).eq("renter_id", user.id).maybeSingle();
    if (error) throw error;
    // Missing and other-account references have identical responses.
    if (!hold) return res.status(200).json({ status: "not_found" });
    verifyBookingHoldSnapshot(hold);
    const sessionId = hold.stripe_checkout_session_id;
    const account = hold.expected_connected_account_id;
    if (typeof sessionId !== "string" || !sessionId.startsWith("cs_") ||
        typeof account !== "string" || !account.startsWith("acct_")) {
      return res.status(409).json({ error: "This checkout cannot be released here." });
    }
    const { data: pending, error: pendingError } = await supabaseAdmin.from("pending_booking_extensions")
      .select("id").eq("stripe_checkout_session_id", sessionId).maybeSingle();
    if (pendingError) throw pendingError;
    const { data: booking, error: bookingError } = await supabaseAdmin.from("bookings")
      .select("id").eq("stripe_checkout_session_id", sessionId).maybeSingle();
    if (bookingError) throw bookingError;
    if (pending || booking) return res.status(409).json({ error: "Check My Bookings and Transactions for this checkout." });

    let current = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: account });
    const matches = session => session?.id === sessionId && session.mode === "payment" &&
      session.currency === "cad" && session.amount_total === hold.expected_total_cents &&
      typeof session.livemode === "boolean";
    if (!matches(current) || current.payment_status !== "unpaid" || !["open", "expired"].includes(current.status)) {
      return res.status(409).json({ error: "Checkout may have completed. Check My Bookings and Transactions." });
    }
    if (current.status === "open") {
      // Never delete a hold on an expiry failure: payment may have won.
      await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: account });
    }
    const previous = { ...current, status: "expired" };
    current = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: account });
    if (!matches(current) || !isExpectedCheckoutTermination(previous, current, "checkout.session.expired", account)) {
      return res.status(409).json({ error: "Unable to verify checkout cancellation. Check your booking status." });
    }
    const { error: releaseError } = await supabaseAdmin.from("booking_holds").delete()
      .eq("id", hold.id).eq("renter_id", user.id)
      .eq("stripe_checkout_session_id", sessionId)
      .eq("expected_connected_account_id", account);
    if (releaseError) throw releaseError;
    return res.status(200).json({ status: "released" });
  } catch (error) {
    console.error("cancel-booking-checkout error:", error?.name || "Error");
    return res.status(503).json({ error: "Couldn't verify checkout cancellation. Check My Bookings and Transactions before trying again." });
  }
}
