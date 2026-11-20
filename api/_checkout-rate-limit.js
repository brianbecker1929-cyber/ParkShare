const limits = {
  active_checkouts: "You already have two unpaid parking checkouts open. Finish or cancel one",
  two_hour_limit: "You've reached the limit of four parking checkout starts in two hours",
  daily_limit: "You've reached the limit of twelve parking checkout starts in 24 hours",
};

// Only accept the small, versioned refusal produced by our hold RPC. Never
// display arbitrary database errors, details, account IDs or provider text.
export function checkoutRateLimit(error, now = Date.now()) {
  const fallback = { error: "You've reached a temporary parking checkout limit. Please try again later or contact ParkShare support.", code: "checkout_rate_limited" };
  if (error?.code !== "P0058" || typeof error.details !== "string" || error.details.length > 1024) return fallback;
  let detail;
  try { detail = JSON.parse(error.details); } catch { return fallback; }
  if (!detail || detail.version !== 1 || !Object.hasOwn(limits, detail.reason)
      || !Array.isArray(detail.limits) || !detail.limits.includes(detail.reason)
      || detail.limits.some(reason => !Object.hasOwn(limits, reason))
      || typeof detail.retry_at !== "string") return fallback;
  const retryAt = Date.parse(detail.retry_at);
  if (!Number.isFinite(retryAt) || !Number.isFinite(now) || retryAt < now - 60_000 || retryAt > now + 86_400_000) return fallback;
  const retryAfterSeconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const wait = minutes === 1 ? "about 1 minute" : `about ${minutes} minutes`;
  return {
    error: `${limits[detail.reason]}. Try again in ${wait}. This temporary limit clears automatically; new checkout starts can change the wait.`,
    code: "checkout_rate_limited",
    reason: detail.reason,
    retryAt: new Date(retryAt).toISOString(),
    retryAfterSeconds,
  };
}
