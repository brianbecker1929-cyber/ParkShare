// Pure, read-only classification of Stripe Checkout events against ParkShare rows.
// No Stripe/Supabase client imports, side effects, booking creation or refunds.
const cents = amount => {
  if (amount === null || amount === undefined || amount === "") return null;
  const value = Number(amount);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
};
const integerId = value => /^[1-9]\d*$/.test(String(value ?? "")) && Number.isSafeInteger(Number(value))
  ? Number(value) : null;

export function reconcilePaidCheckout({ session, eventAccount = null, eventLivemode, booking = null, extension = null, listingIds = new Set(), profileIds = new Set(), expectedLivemode }) {
  if (!session || session.payment_status !== "paid") return { status: "not_paid", severity: "info" };
  if (eventLivemode !== expectedLivemode || (typeof session.livemode === "boolean" && session.livemode !== expectedLivemode)) {
    return { status: "stripe_mode_mismatch", severity: "critical" };
  }
  const metadata = session.metadata || {};
  // Connected-account direct-charge events carry event.account. A missing
  // account may mean the webhook received a platform event instead.
  const account = eventAccount || null;
  if (!account || !/^acct_[A-Za-z0-9]+$/.test(account)) {
    return { status: "missing_connect_account", severity: "critical" };
  }
  if (metadata.connected_account_id && metadata.connected_account_id !== account) {
    return { status: "connected_account_mismatch", severity: "critical" };
  }

  const expectedTotal = session.amount_total == null ? NaN : Number(session.amount_total);
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0) {
    return { status: "missing_stripe_amount", severity: "high" };
  }
  if (metadata.total_cents !== undefined && Number(metadata.total_cents) !== expectedTotal) {
    return { status: "checkout_metadata_amount_mismatch", severity: "critical" };
  }

  if (metadata.type === "extension") {
    if (!integerId(metadata.booking_id)) return { status: "invalid_extension_metadata", severity: "critical" };
    if (!extension) return { status: "paid_extension_without_record", severity: "critical" };
    if (Number(extension.booking_id) !== integerId(metadata.booking_id)
      || cents(extension.added_amount) !== expectedTotal
      || extension.stripe_connected_account_id !== account) {
      return { status: "extension_record_mismatch", severity: "critical" };
    }
    return { status: "extension_recorded", severity: "ok" };
  }

  const listingId = integerId(metadata.listing_id);
  const renterId = typeof metadata.renter_id === "string" ? metadata.renter_id : "";
  if (!listingId || !renterId) return { status: "invalid_booking_metadata", severity: "critical" };

  if (!booking) {
    const missingListing = !listingIds.has(listingId);
    const missingRenter = !profileIds.has(renterId);
    return {
      status: missingListing || missingRenter ? "paid_without_booking_missing_references" : "paid_without_booking",
      severity: "critical",
      missingListing, missingRenter,
    };
  }

  const matches = Number(booking.listing_id) === listingId
    && booking.renter_id === renterId
    && cents(booking.total) === expectedTotal
    && booking.stripe_connected_account_id === account
    && (!session.payment_intent
      || booking.stripe_payment_intent_id === (typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id));
  if (!matches) return { status: "booking_record_mismatch", severity: "critical" };
  if (booking.status === "refunded") return { status: "booking_refunded", severity: "review" };
  if (booking.status !== "confirmed") return { status: "booking_nonconfirmed_status", severity: "high" };
  return { status: "booking_recorded", severity: "ok" };
}
