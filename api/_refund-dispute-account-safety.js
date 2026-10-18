// Independent QA safeguard: Stripe refund/dispute events on connected
// accounts are not authorization to edit any booking sharing a payment ID.
// Authorize by BOTH immutable Stripe identifier and registered account.
// Existing financial fields remain unchanged when no owner-matched row exists.
const KEYS = Object.freeze({
  paymentIntent: "stripe_payment_intent_id",
  charge: "stripe_charge_id",
});

export function paymentReconciliationTarget(event, kind, identifier) {
  const connectedAccountId = event?.account;
  const key = KEYS[kind];
  const prefix = kind === "charge" ? "ch_" : "pi_";
  if (!key || typeof connectedAccountId !== "string" ||
    !/^acct_[A-Za-z0-9_]+$/.test(connectedAccountId) ||
    typeof identifier !== "string" || !identifier.startsWith(prefix) ||
    identifier.length <= prefix.length || typeof event?.livemode !== "boolean") return null;
  return { key, identifier, connectedAccountId };
}

export async function applyAccountScopedBookingReconciliation(client, target, update, {
  excludeStatuses = [],
  expectedRefundId,
  label = "refund_dispute",
  logger = console,
} = {}) {
  if (!target) return { applied: false, reason: "no_trusted_account" };
  let query = client.from("bookings").update(update)
    .eq(target.key, target.identifier)
    .eq("stripe_connected_account_id", target.connectedAccountId);
  // Never regress a fully refunded/disputed booking back to a partially
  // refunded state from an out-of-order charge.refunded notification.
  if (excludeStatuses.length) query = query.not("status", "in", `(${excludeStatuses.join(",")})`);
  if (expectedRefundId === null) query = query.is("stripe_refund_id", null);
  else if (typeof expectedRefundId === "string") query = query.eq("stripe_refund_id", expectedRefundId);
  // Without .select(), Supabase returns no rows and can mask a no-match
  // operation. Always inspect Supabase's error even when matched rows = 0.
  const { data, error } = await query.select("id");
  if (error) throw error; // HTTP 500 => Stripe retries, no false success.
  const applied = Array.isArray(data) && data.length > 0;
  if (!applied) logger.warn("[webhook-reconcile] no owner-matched booking", {
    label, connectedAccountId: target.connectedAccountId,
    // Do not disclose customer information or payment object body in logs.
  });
  return { applied, reason: applied ? "updated" : "no_matching_booking" };
}

// Refund lifecycle rows only hold one refund ID. Never quietly overwrite the
// reference to a different partial refund; flag for manual reconciliation.
export function refundRecordPolicy(booking, refundId) {
  if (!booking) return "unmatched";
  if (booking.stripe_refund_id && booking.stripe_refund_id !== refundId) return "manual_reconciliation";
  return "apply";
}
