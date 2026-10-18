// Shared, deterministic extension safety rules. No credentials or I/O.

export function validExtensionHours(value) {
  return typeof value === "number" && Number.isFinite(value)
    && value >= 0.25 && value <= 24
    && Math.abs(value * 4 - Math.round(value * 4)) < 1e-9;
}

// A charge.refunded event is a cumulative charge snapshot, whereas
// refund.updated reports a single Refund object's amount. Do not combine
// them or guess that a partially refunded extension should lose parking time.
export function extensionChargeRefundSnapshot(charge) {
  const refundedCents = Number(charge?.amount_refunded);
  const chargedCents = Number(charge?.amount);
  if (!Number.isSafeInteger(refundedCents) || refundedCents < 0 ||
      !Number.isSafeInteger(chargedCents) || chargedCents < 0 ||
      refundedCents > chargedCents) return null;
  return {
    charge_amount_refunded: refundedCents / 100,
    charge_fully_refunded: charge?.refunded === true && refundedCents === chargedCents,
  };
}

// A paid extension has its own PaymentIntent. The base booking cancellation
// endpoint refunds only the original intent, never an extension. Prevent
// misleading promises of a FULL refund until a policy handles both.
export function requiresManualCancellationForExtensions(rows) {
  return Array.isArray(rows) && rows.length > 0;
}
