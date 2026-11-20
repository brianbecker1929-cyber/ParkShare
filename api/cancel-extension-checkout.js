// Expire the owner's unpaid Stripe session before atomically releasing its
// registered extension hold. A return URL is never proof of non-payment.
import { jsonMethod, requireUser, stripe, supabaseAdmin } from "./_lib.js";
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
      .select("id,listing_id,renter_id,spot_label,starts_at,ends_at,stripe_checkout_session_id,expected_connected_account_id,expected_total_cents")
      .eq("id", holdId).eq("renter_id", user.id).maybeSingle();
    if (error) throw error;
    if (!hold) return res.status(200).json({ status: "not_found" });
    const { data: pending, error: pendingError } = await supabaseAdmin.from("pending_booking_extensions")
      .select("booking_id,renter_id,added_hours,hold_id,stripe_checkout_session_id,expected_connected_account_id,expected_total_cents")
      .eq("hold_id", hold.id).eq("renter_id", user.id).maybeSingle();
    if (pendingError) throw pendingError;
    if (!pending) return res.status(409).json({ error: "This extension checkout cannot be released here." });
    const { data: booking, error: bookingError } = await supabaseAdmin.from("bookings")
      .select("id,listing_id,renter_id,spot_label,stripe_connected_account_id")
      .eq("id", pending.booking_id).eq("renter_id", user.id).maybeSingle();
    if (bookingError) throw bookingError;
    const sessionId = pending.stripe_checkout_session_id;
    const account = pending.expected_connected_account_id;
    const label = value => String(value || "").trim().toUpperCase();
    if (!booking || booking.listing_id !== hold.listing_id || booking.renter_id !== hold.renter_id ||
        pending.hold_id !== hold.id || sessionId !== hold.stripe_checkout_session_id ||
        typeof sessionId !== "string" || !sessionId.startsWith("cs_") ||
        typeof account !== "string" || !account.startsWith("acct_") ||
        account !== hold.expected_connected_account_id || account !== booking.stripe_connected_account_id ||
        pending.expected_total_cents !== hold.expected_total_cents ||
        !Number.isSafeInteger(pending.expected_total_cents) || pending.expected_total_cents < 50 ||
        !Number.isFinite(Number(pending.added_hours)) || Number(pending.added_hours) <= 0 ||
        Date.parse(hold.ends_at) - Date.parse(hold.starts_at) !== Number(pending.added_hours) * 3600000 ||
        label(booking.spot_label) !== label(hold.spot_label)) {
      return res.status(409).json({ error: "Unable to verify the registered extension checkout." });
    }
    let current = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: account });
    const matches = session => session?.id === sessionId && session.mode === "payment" &&
      session.currency === "cad" && session.amount_total === pending.expected_total_cents &&
      typeof session.livemode === "boolean";
    if (!matches(current) || current.payment_status !== "unpaid" || !["open", "expired"].includes(current.status)) {
      return res.status(409).json({ error: "Checkout may have completed. Check your booking and Transactions." });
    }
    if (current.status === "open") await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: account });
    const previous = { ...current, status: "expired" };
    current = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: account });
    if (!matches(current) || !isExpectedCheckoutTermination(previous, current, "checkout.session.expired", account)) {
      return res.status(409).json({ error: "Unable to verify checkout cancellation. Check your booking status." });
    }
    const { data: released, error: releaseError } = await supabaseAdmin.rpc("release_unpaid_extension_checkout", {
      p_checkout_session_id: sessionId, p_connected_account_id: account,
    });
    if (releaseError) throw releaseError;
    if (released !== true) {
      const remaining = await supabaseAdmin.from("booking_holds").select("id")
        .eq("id", hold.id).eq("renter_id", user.id).maybeSingle();
      if (remaining.error) throw remaining.error;
      if (remaining.data) return res.status(409).json({ error: "Check your booking and Transactions before trying again." });
      return res.status(200).json({ status: "not_found" });
    }
    return res.status(200).json({ status: "released" });
  } catch (error) {
    console.error("cancel-extension-checkout error:", error?.name || "Error");
    return res.status(503).json({ error: "Couldn't verify extension cancellation. Check your booking and Transactions before trying again." });
  }
}
