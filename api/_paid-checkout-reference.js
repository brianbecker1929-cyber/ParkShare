// BUG-005158 production FK incident: a missing historical listing, Host or
// Driver is an unresolved paid-booking reference, NOT proof of a fraudulent
// payment and NOT authorization to refund it automatically.
// Keep this distinct from CheckoutIntegrityError, which intentionally handles
// verified payment-integrity mismatches.
//
// Stage values are fixed internal labels. Never expose missing IDs, raw
// Postgres error details, Stripe metadata, addresses or credentials to clients.
export class PaidCheckoutReferenceError extends Error {
  constructor(stage, code = "missing_reference") {
    super("Paid Checkout requires manual reference reconciliation");
    this.name = "PaidCheckoutReferenceError";
    this.stage = stage;
    this.code = code;
  }
}

export function isForeignKeyReferenceFailure(error) {
  return String(error?.code || "").toUpperCase() === "23503";
}

export function requirePaidCheckoutReference(result, stage) {
  const error = result?.error;
  // PGRST116 is PostgREST's precise single-row-not-found status. Other DB
  // faults (including permission errors, 504s, SQL timeouts) MUST propagate
  // unchanged and can be retried according to the existing bounded read path.
  if (error && String(error.code || "").toUpperCase() !== "PGRST116") {
    throw error;
  }
  if (!result?.data || error) {
    throw new PaidCheckoutReferenceError(stage, "missing_reference");
  }
  return result.data;
}

export function translatePaidBookingInsertError(error) {
  // Do not mistake a late FK race or cross-environment database mapping for
  // a payment-integrity violation. This requires Stripe-vs-Supabase audit,
  // never a guessed parent record, silent success or automatic refund.
  return isForeignKeyReferenceFailure(error)
    ? new PaidCheckoutReferenceError("booking_foreign_key", "23503")
    : error;
}

export function paidCheckoutReferenceLog(error, { eventId, sessionId, eventType, connectedAccountId, livemode } = {}) {
  if (!(error instanceof PaidCheckoutReferenceError)) return null;
  // Only stable internal identifiers; no user identifiers or payment content.
  return {
    issue: "paid_checkout_reference_reconciliation_required",
    stage: error.stage,
    code: error.code,
    eventId: eventId || null,
    sessionId: sessionId || null,
    eventType: eventType || null,
    connectedAccountId: connectedAccountId || null,
    livemode: typeof livemode === "boolean" ? livemode : null,
    action: "inspect_Stripe_payment_account_mode_and_registered_Supabase_hold_do_not_refund_automatically",
  };
}
