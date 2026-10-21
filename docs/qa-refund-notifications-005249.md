# BUG-005249 — cancellation and refund receipts

Successful refunds previously updated the booking/financial ledger but never
notified the Driver or Host. A trigger now queues one independent notification
for each recipient in the same transaction as the verified ledger transition
to `succeeded`. The existing account, payment, charge, amount and event checks
remain in the refund reconciler; this change creates no charges or refunds.

## Behaviour

- A full booking refund produces a cancellation/refund receipt if the booking
  is cancelled/refunded. Partial refunds retain the reservation status and state
  that the booking remains confirmed when appropriate.
- Each additional refund gets its own individual amount and refund reference;
  a receipt does not claim all charges or extensions have been refunded.
- Extension-payment refunds explicitly identify the extension payment and
  resolve the correct parent booking. They do not grant parking time.
- Driver and Host receive separate emails. Recipient addresses come from the
  booking and listing owners, never webhook metadata or a request parameter.
- Pending, failed, cancelled and action-required refunds do not send a success
  receipt. A known pending refund queues receipts when it newly succeeds.
- Duplicate events and repeated ledger snapshots do not enqueue duplicates.
- Rollout does not backfill old receipts. Newly discovered historical successes
  are suppressed; existing ledger rows are not rewritten by the migration.

The new receipt uses ParkShare's signature wordmark, navy/amber palette and
Parker/William portrait for the corresponding recipient. It includes the refund
amount, refund ID, booking ID, property, space, saved vehicle, original session
and property-local times. Driver actions open My Bookings; Host actions open
the Host dashboard. `APP_URL` rewrites every site link/image to the QA origin.
Bank posting time is not promised and the Host receipt is not a payout statement.

## Reliability and rollout

Apply `20261021111213_refund_notifications_005249.sql` before deploying. Queue
and rollout settings have RLS and no anonymous/authenticated privileges. The
cron `/api/send-refund-notifications` runs every minute using `CRON_SECRET`.
QA scans only test-mode refunds. It claims up to ten jobs per run using a
conditional two-minute lease; one recipient failure cannot suppress the other.
The first provider payload is frozen with its first-attempt time. Retries reuse
that payload and database/job-scoped Resend key. Only a provider acceptance ID
marks delivery complete. Unknown outcomes older than 23 hours are blocked for
operator reconciliation before Resend's 24-hour idempotency cache expires.

Email/provider failures do not undo a completed refund. The queue continues
retrying independently of Stripe webhook retries. A success that later changes
to a non-success ledger state before sending is suppressed for review. Queue
schema failure rolls back the ledger transaction so Stripe can retry it.

Native PostgreSQL probes cover queue creation, partial/multiple/full and
extension refunds, pending transitions, duplicate delivery, rollback, historical
suppression, private grants and claims. Worker tests cover actual Resend request
payloads, recipient isolation, canonical dates, escaping, QA links, failed
lookups, provider failures, overlapping claims, unknown outcomes and retry limits.

## BetterQA retest

On https://parkshare-qa.vercel.app with fresh Stripe test bookings:

1. Cancel an eligible paid booking. After Stripe confirms the full refund,
   verify a Driver email and separate Host email confirming cancellation and
   the exact refunded amount/reference. Allow the next minute's cron tick plus
   provider/inbox time. Check spam folders.
2. Verify booking ID, vehicle, correct space (including E–H where configured),
   property-local dates/times and QA action links.
3. Issue a partial refund. Both receipts must show that individual refund and
   must not say the confirmed reservation was cancelled. A second partial
   refund should produce exactly one additional receipt per recipient.
4. Replay refund events: no duplicate receipts. Pending/failed refunds must not
   produce success receipts. Verify a successful extension refund identifies
   the extension and does not change the original reservation's paid duration.

Automatic idle cron completion verifies scheduling, access and queue reads;
fresh inbox/Stripe acceptance remains for BetterQA. Production is not deployed.
