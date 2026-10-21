// Scope the API version to Checkout creation only. The existing SDK defaults
// to 2024-06-20, before per-session Adaptive Pricing controls were added.
export const CAD_CHECKOUT_API_VERSION = "2024-11-20.acacia";

export function requireCadCheckout(session, expectedTotalCents) {
  if (session?.currency !== "cad" || session?.amount_total !== expectedTotalCents ||
      session?.adaptive_pricing?.enabled !== false) {
    throw new Error("Unable to confirm a CAD-only checkout. Please try again or contact support.");
  }
}
