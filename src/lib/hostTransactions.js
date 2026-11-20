// Keep refunded rows visible and use only verified remaining proceeds.
const POSITIVE_HOST_TRANSACTION_STATUSES = new Set(["confirmed", "completed"]);

export function hostTransactionPresentation(transaction) {
  const status = String(transaction?.earningsStatus || transaction?.status || "").toLowerCase();
  if (transaction?.earningsState === "needs_review") return { label: status === "disputed" ? "Disputed" : "Earnings under review", isIncome: false };
  if (status === "refunded") return { label: "Refunded", isIncome: false };
  if (status === "partially_refunded") return { label: "Partially refunded", isIncome: transaction?.earningsState === "verified" && Number(transaction.net) > 0 };
  if (status === "refund_pending") return { label: "Refund pending", isIncome: transaction?.earningsState === "verified" && Number(transaction.net) > 0 };
  if (status === "disputed") return { label: "Disputed", isIncome: false };
  if (status === "cancelled" || status === "canceled") return { label: "Cancelled", isIncome: false };
  if (status === "payment_failed") return { label: "Payment failed", isIncome: false };
  if (status === "pending") return { label: "Pending", isIncome: false };
  if (!POSITIVE_HOST_TRANSACTION_STATUSES.has(status)) return { label: "Review status", isIncome: false };
  return { label: "Earned", isIncome: true };
}

export function hostEarnedTotal(transactions) {
  return (transactions || []).reduce((sum,transaction)=>sum+Math.round(hostEarningsContribution(transaction)*100),0)/100;
}

export function hostEarningsContribution(transaction) {
  if (transaction?.earningsState === "needs_review" || transaction?.net == null) return 0;
  const net=Number(transaction.net);
  if(!Number.isFinite(net))return 0;
  const status=String(transaction.earningsStatus || transaction.status || "").toLowerCase();
  if(status === "refunded") return transaction.earningsState === "verified" ? Math.min(net,0) : 0;
  if(hostTransactionPresentation(transaction).isIncome)return net;
  // A fee retained after a partial refund may also exceed remaining receipts.
  if(["partially_refunded","refund_pending"].includes(status) && transaction.earningsState === "verified")return Math.min(net,0);
  return 0;
}
