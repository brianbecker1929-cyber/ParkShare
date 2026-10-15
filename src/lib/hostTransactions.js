// Host Dashboard must not present refunded or disputed bookings as income.
// A transaction remains in the ledger for auditability, even when its net
// contribution to dashboard earnings is zero or its settlement is disputed.
const POSITIVE_HOST_TRANSACTION_STATUSES = new Set(["confirmed", "completed"]);

export function hostTransactionPresentation(transaction) {
  const status = String(transaction?.status || "").toLowerCase();
  if (status === "refunded") return { label: "Refunded", isIncome: false };
  if (status === "partially_refunded") return { label: "Partially refunded", isIncome: false };
  if (status === "disputed") return { label: "Disputed", isIncome: false };
  if (status === "cancelled" || status === "canceled") return { label: "Cancelled", isIncome: false };
  if (status === "payment_failed") return { label: "Payment failed", isIncome: false };
  if (status === "pending") return { label: "Pending", isIncome: false };
  if (!POSITIVE_HOST_TRANSACTION_STATUSES.has(status)) return { label: "Review status", isIncome: false };
  return { label: "Earned", isIncome: true };
}

export function hostEarnedTotal(transactions) {
  return (transactions || [])
    .filter(transaction => hostTransactionPresentation(transaction).isIncome)
    .reduce((sum, transaction) => sum + (Number(transaction.net) || 0), 0);
}
