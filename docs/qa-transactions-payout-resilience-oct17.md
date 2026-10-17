# QA: Transactions should survive Stripe payout-history outages

**Status:** draft only, October 17, 2026. Do not merge to production or alter the active BetterQA test deployment.

## Confirmed source-level failure mode
`GET /api/transactions` awaited `getSpentTransactions`, `getEarnedTransactions`, and Stripe `getPayouts` in the same `Promise.all`. If Stripe payout lookup failed (for example, a temporarily unavailable/deauthorized connected account), the whole endpoint returned HTTP 500. The Driver's already-recorded Supabase spending and the Host's already-recorded earnings could not load despite those records being available. The UI treated all loading errors as a single failure.

## Draft repair
- Extract `loadTransactionHistory` with separate best-effort Stripe payout handling.
- Recorded `spent`/`earned` remain required and are not silently suppressed on database errors.
- Only payout lookups degrade to `payouts: []` plus `payoutsUnavailable: true`. With a normal connected account that simply has zero payouts, the flag is `false`.
- Client shows a payout-specific temporary-unavailable notice instead of the misleading "No payouts yet." empty state, while preserving the user's payments and earnings.
- Logs only Stripe error code/type server-side and never returns raw Stripe errors to browsers.
- User identity still comes from the authenticated Supabase JWT and all database filters remain scoped to that user.

## Test and rollout requirements
- Automated tests: healthy response, no connected account, asynchronous/synchronous Stripe errors, logging error, Supabase history failure, API/UI response contract.
- BetterQA should exercise Driver-only account, Host with a healthy connected account, Host with no payouts, Host with a Stripe test-account lookup failure, and a forced Supabase history failure. Validate status/message and that no unrelated user's records appear.
- Do not treat an unavailable payout lookup as evidence that payouts never occurred. During a Stripe outage the payout section is unknown, not empty.
- Integrate with the independent private-address/RLS draft PR #161 before promotion: transaction-history address visibility should be reviewed as part of that privacy release.
- Confirm the transaction history page works on desktop/mobile and that recovery after a transient Stripe failure clears the warning.
- No database schema changes, Stripe calls involving money movement, production edits, or active QA deployment in this branch.

This is a **source-verified failure mode and draft fix**, not a BetterQA-confirmed reproduction in their active environment. Retest before marking fixed.
