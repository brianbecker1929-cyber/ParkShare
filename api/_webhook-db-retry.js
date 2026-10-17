// BUG-005158: distinguish transient Supabase transport failures from a
// genuinely missing paid booking's listing or Host.
//
// Only idempotent READ queries may be retried here. Stripe creates/refunds
// and multi-write booking/extension confirmations MUST NOT be retried by this
// helper. If the database remains unavailable, let the webhook return a
// retryable error to Stripe rather than acknowledging unprocessed money.
const TRANSIENT_STATUS = new Set([502, 503, 504, 522, 524]);
const TRANSIENT_CODES = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT",
  "PGRST000", "PGRST001", "PGRST002", "08000", "08003", "08006", "08001",
  "57P01", // database shutting down
]);

export function isTransientSupabaseError(error) {
  if (!error || typeof error !== "object") return false;
  if (TRANSIENT_STATUS.has(Number(error.status))) return true;
  if (TRANSIENT_CODES.has(String(error.code || "").toUpperCase())) return true;
  const message = String(error.message || "");
  // Do not use a loose "timeout" match: a persistent SQL statement timeout
  // or a foreign-key/permission failure is not a transient connection fault.
  return /(?:^|\b)(?:gateway timeout|connection timed out|connection reset|fetch failed|error code 522|error code 524)(?:\b|$)/i.test(message)
    || /<title>[^<]*\b(?:522|524):\s*Connection timed out<\/title>/i.test(message);
}

export function isMissingSupabaseRow(error) {
  return String(error?.code || "").toUpperCase() === "PGRST116";
}

export async function retryTransientSupabaseRead(read, {
  pause = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  maxAttempts = 2,
  delayMs = 150,
  onRetry = () => {},
} = {}) {
  // Keep this bounded; Vercel must still have time to respond to Stripe.
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new RangeError("Invalid bounded retry count");
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let result;
    let thrown;
    try {
      result = await read();
    } catch (error) {
      thrown = error;
    }
    const error = thrown || result?.error;
    if (!error || !isTransientSupabaseError(error) || attempt === maxAttempts) {
      if (thrown) throw thrown;
      return result;
    }
    // Never log raw error bodies, addresses, payment metadata or credentials.
    onRetry(attempt);
    await pause(delayMs);
  }
}
