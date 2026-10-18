# BetterQA BUG-005116 — reserve extension time DURING Stripe Checkout
**October 18, 2026 · stacked DRAFT follow-up to #160 · no production or active QA writes**

## Why #160 alone is insufficient
- Base draft PR #160 made **paid extension confirmation atomic**, prevented conflicting/replayed booking-hour writes and prepared refund/dispute audit, but documented one serious unresolved issue:
- `/api/create-extend-session` only did read-only `checkAvailability()` / `checkSpotAvailability()` then opened Stripe Checkout **without claiming the extra time**.
- A Driver could pay after another Driver reserved the spot. The paid webhook would reject the collision but still require **manual reconciliation or refund**. This is a payment/customer-trust issue, not just a calendar display bug.

## Prepared stacked code
- This branch builds **on draft PR #160**, not on `main` and not on active BetterQA QA. Its draft PR should target #160's feature branch.
- `api/create-extend-session.js` now calls service-role `create_booking_hold` **for only [current booking end, requested extended end)** using the authenticated Driver, existing booked spot label and existing listing ID **before creating a Stripe session**.
- The existing RPC uses a listing-scoped advisory transaction lock, checks capacity and exact spot, and serializes competing new bookings and extension holds. Failure `P0001` becomes HTTP 409, **before charging**.
- Checkout hold and Stripe session share an expiry approximately 30m45s from request creation, inside the database's 31-minute maximum lease and Stripe's minimum expiration window.
- After Stripe session creation, service-role code binds `booking_holds.stripe_checkout_session_id`, inserts `pending_booking_extensions.hold_id` and returns the session URL **only after both trusted snapshots are persisted**.
- On Stripe setup/binding/registration failure, the code best-effort expires its orphan session and removes **only that Driver's/listing's specific hold** and pending session entry. Cleanup errors are logged rather than hidden.
- `docs/sql-proposals/qa-atomic-extensions-and-refunds.sql` extends #160's **review-only** SQL proposal: adds a service-role-only `hold_id` snapshot and a unique index, checks that the hold belongs to the trusted payment, exact booking end/new end, listing, Driver and spot, ignores *only that hold* in the capacity/spot conflict tests, and releases it in the **same transaction as booking-hours update**.
- Stripe's existing `checkout.session.expired` / `checkout.session.async_payment_failed` handlers already delete holds and pending records by registered Stripe session ID; tests assert those paths remain.

## Important correctness / security checks
- Two simultaneous checkout requests for the same spot/time: at most one obtains the hold. Other request gets 409 **before opening Stripe**, avoiding two potential charges.
- Same paid Checkout webhook twice or concurrently: transactional RPC records only one paid extension; duplicates are no-ops.
- Malicious/tampered/past/stale `hold_id`, wrong connected Stripe account, wrong Driver, wrong listing or window fails closed, **never trusting Stripe-host-provided metadata or client-provided hold ID**.
- A booking already extended/cancelled or newly occupied after hold expiry still fails safely at webhook. **A paid charge in such an exceptional late-webhook case requires support reconciliation and potentially refund; not claimed automatically refunded.**
- Sequential, non-overlapping extensions should reserve the fresh endpoint and apply once.
- No new blanket discount/price, schedule or refund policy change was made.

## Migration / dependency gates
- **DO NOT deploy only the API code.** It requires the updated review-only SQL with `pending_booking_extensions.hold_id` and enhanced `apply_paid_booking_extension` (plus #160's refund/audit changes).
- The original `create_booking_hold` RPC from migration 011 must exist, with correct service-role execution permissions and listing-lock semantics.
- Review conflict/lock interactions with #167 (unpaid hold abuse limits), #154 (spot availability), #166 (webhook DB errors), #143 (payment integrity), #165 (trusted Stripe return URLs), and #159 (property timezone) before integrated QA test.
- Separately confirm extension Host availability windows and Stripe failure-recovery product policy before public launch.
- Write an **approved numbered Supabase migration** and rehearse in a disposable database, then authorized isolated QA branch/environment before any BetterQA active QA or production change.
- Validate real Stripe TEST extension purchase, aborted checkout, failed registration, payment completed just before lease expiry with webhook delay, webhook retry, overlapping/parallel checkouts, cancellation, receipt emails, Host payouts and partial/full refund support reconciliation.
- No actual Stripe charges/refunds, migrations, Supabase data writes, merges or active BetterQA QA deployments in this work.

## BetterQA handoff checklist
1. Confirm two Drivers cannot simultaneously hold/book the same extension tail.
2. Confirm two extension checkouts for the same booking/spot are prevented before Stripe.
3. Simulate cancelled/expired/failed checkouts and verify hold release; current booking time must not change.
4. Simulate duplicate/concurrent paid webhook deliveries; booking hours should increase exactly once.
5. Simulate a paid checkout with stale/missing/cross-listing/wrong-Driver hold; do not extend time; log and reconcile/refund via approved policy.
6. Verify no extension succeeds if original booking is no longer confirmed.
7. Verify regular **new booking** holds and base Stripe checkout still work.
8. Verify Host receipts and Driver booking emails match exact approved extension hours/amounts.
9. Inspect only privacy-safe logs; do not paste real Host payment credentials into bug reports.
10. Use **Stripe TEST and disposable PostgreSQL**, not live production or active BetterQA QA for first migration.
