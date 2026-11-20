// Validated hourly rate used by Host pricing UI and server checkout checks.
// Preserve existing legal prices, including high-priced historical listings:
// product approval is required before imposing a universal upper ceiling.
export const MIN_HOURLY_RATE_CAD = 1;
export const NEW_LISTING_MAX_HOURLY_RATE_CAD = 200;

export function validateHourlyRate(value, { maxRate = null } = {}) {
  const error = "Enter a valid hourly rate of at least $1.00, with no more than two decimal places.";
  if (typeof value !== "string" && typeof value !== "number") {
    return { valid: false, error, value: null };
  }
  const raw = String(value).trim();
  // Do not allow scientific notation, signs, currency symbols or non-decimal
  // values to be silently coerced or rounded into a different Host rate.
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    return { valid: false, error, value: null };
  }
  const number = Number(raw);
  const cents = Math.round(number * 100);
  if (!Number.isFinite(number) || !Number.isSafeInteger(cents)
      || cents < MIN_HOURLY_RATE_CAD * 100
      || Math.abs(number * 100 - cents) > 1e-7) {
    return { valid: false, error, value: null };
  }
  if (maxRate != null && cents > maxRate * 100) {
    return { valid: false, error: `For new listings, choose an hourly rate no higher than $${maxRate.toFixed(2)} CAD.`, value: null };
  }
  return { valid: true, error: null, value: cents / 100 };
}
