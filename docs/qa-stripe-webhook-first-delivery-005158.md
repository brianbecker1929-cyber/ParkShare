# BUG-005158 — first Stripe Checkout webhook delivery returns HTTP 500
**Draft code + incident triage, October 17, 2026 — NOT DEPLOYED**

## Evidence inspected (read-only)
- BetterQA described: first `checkout.session.completed` delivery may return HTTP 500.
- The **ParkShare-QA** Vercel project's seven-day webhook error groups contain two `checkout.session.completed` failures with verbose Supabase 522 HTML/connection timeout, plus one group occurrence with `Gateway Timeout` (October 15). An additional cluster of `account.updated` errors shows the same Supabase 522/connectivity fault. These are **error occurrences**, not verified unique paid bookings.
- The **production ParkShare** Vercel project's webhook error group contains 84 logged occurrences October 14–16, including SQLSTATE 23503 for **missing listing/profile foreign keys**. Distinct paid Stripe events and their correct environment have NOT yet been reconciled. See draft PR #156 and `docs/stripe-payment-reconciliation.md`.
- QA code in `hostAccountForListing()` converted **any** `listings` or `profiles` read error into `CheckoutIntegrityError`. Its caller handles this class by issuing an **automatic connected-account refund**. A temporary Supabase outage can therefore be mistaken for a permanently missing Host or listing. **This was confirmed in code, not as an observed refund.**

## Isolated application repair
- Added `api/_webhook-db-retry.js`: transient Supabase 502/503/504/522/524 and recognized transport/network failures get **at most one bounded repeat** for idempotent read-only lookups.
- Preflight idempotency, Checkout hold and pending extension lookups now use the read-only retry helper.
- Host/listing lookups retry temporary failures and **rethrow non-missing database errors**. They no longer automatically translate gateway/connection outages into payment-integrity failures/refunds.
- Genuine missing-row responses (`PGRST116` or null with no error) remain integrity failures under the existing policy; the payment-integrity checks and fee/account validation are unchanged.
- If Supabase is still unavailable, the webhook returns **HTTP 500** as intended so Stripe can retry; it never returns 200 to pretend a paid booking was confirmed.
- No retries were added around Stripe payments/refunds, booking/extension writes, or customer emails because their effects require stronger idempotency and integration verification (extension atomicity belongs to draft PR #160).
- Regression tests cover transient/terminal errors, bounded attempts, true missing rows vs outages, and webhook routing.

## What this DOES NOT resolve
- Persistent production SQLSTATE **23503** missing listing/profile references. These may represent misrouted test/QA deliveries, deleted references, or another history problem. Do not infer cause without Stripe delivery event/account/mode evidence.
- Already-processed paid sessions where a first error prevented a confirmation email. Do not replay blindly.
- `processPaidCheckout()` intentionally ignores unrelated Stripe Standard connected-account sessions; it cannot safely create a ParkShare booking from unsigned/unregistered metadata. Missing registered paid bookings require manual reconciliation.
- Payment-extension multi-write race and checkout hold expiration (PR #160); timezone release dependencies (PR #159).
- External Supabase outage itself: application backoff reduces a subset of intermittent first-delivery errors, but Stripe retry and incident monitoring remain required.

## BetterQA controlled QA acceptance checks
1. Confirm the initial reported Stripe TEST event ID, exact checkout-session and connected-account IDs, mode, and first/retry delivery statuses. Share securely, not in public GitHub or email with customer PII.
2. With a signed **Stripe TEST** event and a registered QA hold, inject a one-time 504/522 at the Host/listing or hold read. Verify the handler can recover, confirm **exactly one booking**, and send no unintended refund.
3. Simulate repeated unavailable Supabase reads. Confirm 500 until recovery; Stripe retries the same event; no duplicate booking/extension/confirmation or refund; no success acknowledgement without a durable booking.
4. Distinguish a genuine missing listing/profile from an outage; review refund policy and capture the appropriate audit entry.
5. Verify missing/unknown Checkout Sessions aren't promoted from untrusted metadata, connected-account and amount checks still reject forgery, and error logs don't expose secrets or customer data.
6. Correlate distinct Stripe event IDs with Supabase bookings and connected accounts in production before resolving production 23503 failures. Review PR #156 reconciliation script; **do not replay or refund without an approved finance decision**.
7. Test combined integration with draft PR #160 and PR #159 on an isolated preview, preserving BetterQA's active QA database and payment-test schedule.

## Release boundary
Keep as **DRAFT**. No production merge, no current BetterQA QA deployment, no database migration or data edits, no Stripe event resends, no charge/refund actions. This patch is ready for code review **only** until GitHub CI, Vercel preview and independent BetterQA Stripe TEST retesting pass.
