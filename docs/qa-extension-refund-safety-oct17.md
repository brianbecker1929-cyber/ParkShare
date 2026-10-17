# BetterQA extension payments/refunds — safety audit and release gate
**October 17, 2026 · draft review only · DO NOT DEPLOY OR RUN SQL**

## Confirmed code defects (QA release branch)
1. Stripe webhook inserted a booking_extensions row, then separately updated bookings.hours. If second write failed, a replay saw the extension row and returned without increasing hours, leaving a paid extension unapplied.
2. Two paid extensions can both read the same original booking.hours and overwrite one another ("lost update"). Time eligibility/spot availability is checked before checkout, but another reservation can appear before the payment webhook arrives.
3. Stripe refund/dispute events update only bookings, not the separate payment intents on booking_extensions.
4. The cancel-booking endpoint offers a "full refund" but refunds only the original booking PaymentIntent, even when paid extensions exist.

## Read-only database verification
- ParkShare-QA: zero recorded booking_extensions and zero pending_booking_extensions at inspection time; no existing QA extension data to reconcile.
- QA bookings.session_range is recomputed by a BEFORE INSERT/UPDATE trigger.
- QA has a confirmed-spot EXCLUDE gist constraint and booking extension unique Checkout Session index.
- QA booking_extensions has no refund/reconciliation fields yet.
- These observations say nothing about historical **production** extension charges; Stripe cannot be audited without access and has not been queried.

## Proposed draft changes
- Make extension durations exact quarter-hours on checkout (0.25–24 hours).
- Replace two webhook writes with one service-role-only SECURITY INVOKER Postgres function. It locks the registered extension and booking, uses the same listing-level advisory lock as booking holds, checks the trusted session/payment attributes and available capacity/spot, inserts extension and increments booking hours in ONE transaction. Failed writes never leave a bogus success marker; identical Stripe event replay is idempotent.
- Add refund lifecycle, cumulative charge-refund and dispute markers on extension rows, matched by PaymentIntent/Charge and Stripe connected-account ID. Do **not** change the parking entitlement automatically after a refund.
- Block self-serve automatic cancellation when ANY paid extension exists; refer to support for review of BOTH base and extension charges.
- New source tests exercise core pure rules plus source/SQL structural safeguards. Full concurrency and actual Stripe workflow MUST be tested separately.
- See docs/sql-proposals/qa-atomic-extensions-and-refunds.sql. This is NOT a numbered migration and must not be applied automatically.

## Critical conditions before deploying
1. BetterQA must approve a coordinated database migration and webhook application rollout. Use the Supabase CLI migration generator for a reviewed migration; check PostgREST RPC availability and function privileges. Never deploy webhook code before its RPC/schema exists.
2. Test checkout and webhook under real Stripe TEST connected accounts, verifying amount/account, duplicate deliveries, simultaneous extension payments, lost-write injection, expired holds, booking conflict and a callback after original session end.
3. **Payment-versus-capacity gap remains:** extension checkout currently does NOT reserve its extra time. Another Driver can book that interval while Stripe Checkout is open. In such a race, the SQL proposal safely rejects the extension instead of overbooking and webhook returns a retriable error, BUT the customer has paid. Customer-support reconciliation/refund and an approved hold-at-checkout design are a launch gate. No automatic refund is assumed.
4. Historical payment audit required: paid extension rows vs booking hours, original and extension Stripe PaymentIntents and refunds. The extension count by itself does not prove a payment succeeded.
5. Confirm cancellation/refund business policy: should a full base cancellation also refund paid extensions? What if an extension refund occurs after parking has begun or a later extension was booked? Do not silently subtract occupied time.
6. Confirm all refund webhooks arrive with event.account for connected accounts. Do not trust metadata or accept a refund event whose account differs from the stored extension account.
7. Verify compensation when email delivery fails, payment is refunded but a booking update fails, or paid extension is rejected with P0001; reconcile manually before claiming success.
8. Repair the separate timezone defect BUG-005156 across UI, database, availability, checkout and emails before launch. This draft does not change time-zone behavior.
9. Have BetterQA test on the **isolated preview** after approved migration, not on the active ParkShare-QA database without an agreed window.

## Suggested BetterQA regression matrix
- Normal active booking +0.25h / +1h / +24h; reject unsupported increment, past booking, unconfirmed booking.
- Duplicate checkout.session.completed: one extension row, exactly one hours increment, exactly one confirmation email.
- Force DB exception between insert and update: extension row and hours both unchanged, webhook returns retryable failure and case appears in incident log.
- Two parallel paid extensions on same booking: no lost hours; each paid session applied exactly once or escalated.
- One free spot, second Driver holds or books extension window between checkout and webhook: no double booking; paid conflict escalates.
- charge.refunded partial/full, refund.failed/retried, charge.dispute.created for extension payment; verify exact connected account, status markers, and no silent change to booking duration.
- Base cancellation with one or more paid extensions: clear 409 support_required, no Stripe refund initiated.
- Stripe retry after connection interruption, refund failure, and extension that receives payment after booking ends.
- Confirm no cross-environment Stripe/test webhook deliveries.

## Risk assessment
This draft prevents a class of silently lost paid-hours records once the RPC is deployed correctly. It does NOT yet ensure every paid extension is fulfilled or refunded, because the extension checkout time is not reserved. Do not mark this audit as fully resolved or launch-ready without the remaining capacity-hold and reconciliation decisions.
