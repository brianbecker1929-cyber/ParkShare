// Keep the signed-in user's recorded spending and earnings independent of
// Stripe Connect's live payout-history lookup. Payouts are an external,
// best-effort read; Supabase booking history remains authoritative.
// Important: errors retrieving spent/earned data still fail the request.
// Never represent an unavailable Stripe response as "no payouts yet".
export async function loadTransactionHistory({
  loadSpent,
  loadEarned,
  loadPayouts,
  onPayoutError = () => {},
}) {
  const payoutResult = Promise.resolve()
    .then(() => loadPayouts())
    .then(
      payouts => ({ payouts, payoutsUnavailable: false }),
      error => {
        try {
          onPayoutError(error);
        } catch {
          // A logging failure must not remove the user's booking history.
        }
        return { payouts: [], payoutsUnavailable: true };
      }
    );
  const [spent, earned, payoutHistory] = await Promise.all([
    Promise.resolve().then(() => loadSpent()),
    Promise.resolve().then(() => loadEarned()),
    payoutResult,
  ]);
  return { spent, earned, ...payoutHistory };
}
