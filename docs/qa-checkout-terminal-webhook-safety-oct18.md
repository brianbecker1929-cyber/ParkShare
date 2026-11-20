# ParkShare QA — Stripe Checkout terminal webhook safeguards
**Independent security/reliability finding · 18 October 2026 · review-only**

## Root issue confirmed in source
`api/stripe-webhook.js` processed signed `checkout.session.async_payment_failed` and `checkout.session.expired` callbacks using only the Checkout Session ID:
- The failure case directly deleted `booking_holds` and `pending_booking_extensions` without checking the account that registered the Checkout.
- The failure case directly updated `bookings.status = "payment_failed"` by Session ID alone, **without restricting to unpaid/pending bookings**.
- The expiration case similarly deleted holds and pending extensions without checking the Host connected account or Stripe's current terminal status.

Stripe documents these as separate asynchronous-payment failure and checkout expiration events; the event snapshot should not be treated as permission to mutate a paid booking. A signed event's connected-account context must also match the service-role registration. The original source made no such check. **Actual malicious events or corrupted bookings have not been demonstrated**.

## Draft safeguards
- Both events now pass through `processCheckoutTermination(event)`, which **does not write anything** for absent/invalid event account, missing/changed Checkout state, inconsistent Stripe TEST/LIVE modes, paid Checkout sessions, or a paid/finalized booking.
- Fetch the current Checkout Session directly **from the event's Stripe connected account** before any destructive DB operation. Only terminal **`expired`** sessions or completed **`async_payment_failed`** sessions whose payment_status is still **`unpaid`** qualify. If Stripe retrieval fails, the webhook returns HTTP 500 for retry, without deleting holds or changing bookings.
- Read the matching registered hold and extension audit record using PR #166's bounded idempotent-read retry. If both records match the same session ID, fail closed and require operator reconciliation; never guess which record to delete.
- Require `expected_connected_account_id` stored by ParkShare service-role for either hold or extension. Ignore unrelated connected-account events; never trust Host-editable Stripe metadata to choose a local row.
- `DELETE` queries include all of **row ID**, **registered Checkout Session ID** and **expected connected account ID**. Database errors propagate to HTTP 500; no silent success.
- A pending Booking is marked payment_failed only for the signed `async_payment_failed` event, and only with `status = "pending"`, `paid_at IS NULL`, matching booking Session ID and connected account ID. These predicates are also part of the SQL UPDATE, not merely a prior application-level check, to avoid downgrading a booking finalized between queries.
- A confirmed/refunded/completed/disputed/paid booking is left unchanged. No automatic refunds or payment captures are performed here.
- No schema migration, no user-facing UI change, no emails and no changes to unrelated Stripe event handlers.

## Regression tests
- Pure state/account predicates: wrong Host, no connected account, missing/invalid session ID, mismatched TEST/LIVE mode, stale/current paid session, expired vs async-failed status, pending vs confirmed/refunded/paid booking.
- Webhook source tests: actual Stripe API state check comes first, proper service-role read checks, identity-bound conditional delete predicates, conditional unpaid-only status updates and no raw direct deletes in the switch.
- Disposable PostgreSQL proofs: simulated delayed failure leaves confirmed and refunded bookings unchanged; pending booking can be failed only by own connected account; unrelated Host cannot delete registered booking hold or pending extension.
- GitHub Actions and preview status to be independently verified on the final head.

## BetterQA acceptance
1. Test genuine Stripe TEST expired Session and genuine async failed delayed payment, using **registered test holds** only. Verify holds/pending extension releases appropriately.
2. Use a signed event from another Host's connected account with a different registration; ensure it cannot delete hold or pending extension from ParkShare's other Host.
3. Confirm signed late failure cannot turn an already confirmed, refunded or paid booking into payment_failed.
4. Simulate an event with an old/unpaid snapshot but a now-paid Stripe Session; no cleanup and no booking mutation.
5. Verify invalid TEST/LIVE status mismatch does not cause any local writes.
6. Verify Stripe REST retrieval outage and Supabase query/write outages return a retryable webhook failure; no false HTTP 200.
7. Test duplicate terminal events and concurrent paid/failed events, including competing extension checkouts. Final paid booking must stay confirmed.
8. Review logs and ensure no sensitive Driver details or Stripe API credentials are emitted.
9. Confirm routine booking, extension, email and payout flows are unaffected.
10. Coordinate integration with PRs #143, #160/#174, #166/#175 before deployment.

## Dependencies / release
**Stacked DRAFT** on PR #175 (which itself builds on #166); **DO NOT merge or deploy** to active BetterQA QA or production without an approved integration plan. Backend Stripe TEST and connected-account scenario verification remain outstanding. The new handler performs a Stripe Session retrieval on terminal events, which requires correct API account access and should be verified under Stripe TEST.

This is a prepared safety correction, not evidence of actual payments or bookings being changed improperly in production. No database migrations, webhook replays, charges, refunds, or changes to live ParkShare data were made.
