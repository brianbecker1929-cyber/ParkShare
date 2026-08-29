// Deterministic Stripe refund/dispute reconciliation rules.
//
// Keep this module free of Stripe, Supabase, and environment access so the
// exact database identifiers and status transitions can be regression-tested
// without sending a refund or touching production records.

export function stripeObjectId(value) {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && typeof value.id === "string" && value.id.trim()) {
    return value.id;
  }
  return null;
}

export function refundReconciliation(charge) {
  const paymentIntentId = stripeObjectId(charge?.payment_intent);
  if (!paymentIntentId) return null;

  return {
    paymentIntentId,
    status: charge?.refunded === true ? "refunded" : "partially_refunded",
  };
}

export function refundEventReconciliation(refund) {
  const paymentIntentId = stripeObjectId(refund?.payment_intent);
  const refundId = stripeObjectId(refund);
  if (!paymentIntentId || !refundId) return null;

  const allowedStatuses = new Set(["pending", "requires_action", "succeeded", "failed", "canceled"]);
  const status = String(refund?.status || "").toLowerCase();
  if (!allowedStatuses.has(status)) return null;

  return {
    paymentIntentId,
    refundId,
    refundStatus: status,
    refundAmount: Number(refund?.amount || 0) / 100,
    refundFailureReason: refund?.failure_reason || null,
  };
}

export function disputeReconciliation(dispute) {
  const chargeId = stripeObjectId(dispute?.charge);
  return chargeId ? { chargeId, status: "disputed" } : null;
}
