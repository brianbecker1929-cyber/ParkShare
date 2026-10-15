// Validate provider-confirmed payments against a trusted server-side
// Checkout Session record. Stripe's webhook signature authenticates Stripe;
// it does NOT establish that connected-account metadata was created by ParkShare.
export class CheckoutIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckoutIntegrityError";
  }
}

function must(condition, message) {
  if (!condition) throw new CheckoutIntegrityError(message);
}

export function verifyPaidCheckout({
  session, eventAccount, expectedSessionId, expectedConnectedAccountId,
  actualHostAccountId, expectedTotalCents, expectedApplicationFeeCents, paymentIntent,
}) {
  must(typeof eventAccount === "string" && eventAccount.startsWith("acct_"),
    "Connected-account identity is missing from Stripe event");
  must(eventAccount === expectedConnectedAccountId && eventAccount === actualHostAccountId,
    "Payment was submitted through an unrelated connected account");
  must(session?.id === expectedSessionId && session?.mode === "payment",
    "Checkout Session is not one ParkShare registered");
  must(session.payment_status === "paid", "Checkout Session is not paid");
  must(session.currency === "cad", "Unexpected Checkout Session currency");
  must(Number.isSafeInteger(expectedTotalCents) && expectedTotalCents >= 50,
    "Trusted expected amount is missing or invalid");
  must(session.amount_total === expectedTotalCents,
    "Paid amount does not match the trusted Checkout total");
  must(Number.isSafeInteger(expectedApplicationFeeCents) && expectedApplicationFeeCents >= 0
    && expectedApplicationFeeCents <= expectedTotalCents,
    "Trusted application fee is missing or invalid");
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent : session.payment_intent?.id;
  must(paymentIntentId && paymentIntent?.id === paymentIntentId,
    "PaymentIntent does not belong to Checkout Session");
  must(paymentIntent.status === "succeeded"
    && paymentIntent.currency === "cad"
    && paymentIntent.amount_received === expectedTotalCents,
    "PaymentIntent settlement does not match the trusted total");
  must(paymentIntent.application_fee_amount === expectedApplicationFeeCents,
    "ParkShare application fee is different from the trusted amount");
  return { paymentIntentId, chargeId: typeof paymentIntent.latest_charge === "string"
    ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id || null };
}

export function verifyBookingHoldSnapshot(hold) {
  const metadata = hold?.checkout_metadata;
  must(metadata && typeof metadata === "object", "Unregistered or legacy booking hold");
  must(String(metadata.hold_id) === String(hold.id), "Checkout hold ID mismatch");
  must(String(metadata.listing_id) === String(hold.listing_id), "Checkout listing mismatch");
  must(String(metadata.renter_id) === String(hold.renter_id), "Checkout renter mismatch");
  must(String(metadata.connected_account_id) === String(hold.expected_connected_account_id),
    "Checkout Host account mismatch");
  must(Number(metadata.total_cents) === Number(hold.expected_total_cents),
    "Checkout amount snapshot mismatch");
  const hours = Number(metadata.hours);
  const windowHours = (new Date(hold.ends_at).getTime() - new Date(hold.starts_at).getTime()) / 3600000;
  must(Number.isFinite(windowHours) && windowHours > 0
    && Number.isFinite(hours) && Math.abs(hours - windowHours) < 0.001,
    "Checkout booking duration does not match its reserved window");
  must(Number(metadata.subtotal_cents) + Number(metadata.service_fee_cents) === Number(hold.expected_total_cents),
    "Checkout item totals do not match the amount authorized");
  must(String(metadata.spot_label || "").toUpperCase() === String(hold.spot_label || "").toUpperCase(),
    "Checkout parking spot mismatch");
  return metadata;
}
