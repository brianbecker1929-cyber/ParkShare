// Payment lifecycle events may be delivered after another signed event.
// Never infer a missing/failed payment from a bare Checkout Session ID:
// require the trusted connected account and Stripe's current terminal status.
export function isExpectedCheckoutTermination(eventSession, stripeSession, kind, connectedAccountId) {
  if (kind !== "checkout.session.expired" && kind !== "checkout.session.async_payment_failed") return false;
  if (typeof connectedAccountId !== "string" || !connectedAccountId.startsWith("acct_")) return false;
  if (!eventSession || !stripeSession || typeof eventSession.id !== "string") return false;
  if (!eventSession.id.startsWith("cs_") || eventSession.id !== stripeSession.id) return false;
  if (eventSession.payment_status !== "unpaid" || stripeSession.payment_status !== "unpaid") return false;
  if (typeof eventSession.livemode !== "boolean" ||
      stripeSession.livemode !== eventSession.livemode) return false;
  const expectedStatus = kind === "checkout.session.expired" ? "expired" : "complete";
  return eventSession.status === expectedStatus && stripeSession.status === expectedStatus;
}

// Match against service-role-only snapshot, never Host-edited Stripe metadata.
// A signed event from a different connected account cannot release another
// Host's booking hold or extension record.
export function matchesRegisteredCheckoutAccount(row, connectedAccountId) {
  return typeof row?.expected_connected_account_id === "string" &&
    row.expected_connected_account_id.length > 0 &&
    row.expected_connected_account_id === connectedAccountId;
}

export function canFailUnpaidBooking(booking, connectedAccountId) {
  return booking?.status === "pending" &&
    booking?.paid_at == null &&
    booking?.stripe_connected_account_id === connectedAccountId;
}
