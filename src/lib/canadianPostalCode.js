// Canada Post uses an alternating letter/number A1A 1A1 postal-code format.
// Letters D, F, I, O, Q, U never appear; W and Z may not lead a code.
// This checks syntax only; it cannot verify a particular street or a code's
// existence. A geocoding/address-verification provider is required for that.
const CANADIAN_POSTAL_PATTERN = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/;

export const CANADIAN_POSTAL_HELP = "Enter a Canadian postal code in the format A1A 1A1.";

export function validateCanadianPostalCode(value) {
  if (typeof value !== "string") {
    return { valid: false, normalized: null, error: CANADIAN_POSTAL_HELP };
  }
  const upper = value.trim().toUpperCase();
  if (!CANADIAN_POSTAL_PATTERN.test(upper)) {
    return { valid: false, normalized: null, error: CANADIAN_POSTAL_HELP };
  }
  const compact = upper.replace(" ", "");
  return {
    valid: true,
    normalized: compact.slice(0, 3) + " " + compact.slice(3),
    error: null,
  };
}
