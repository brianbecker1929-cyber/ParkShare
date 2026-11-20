# Extension settlement — BUG-005116 / BUG-005260

## Defect and repair

A normal extension Checkout deliberately registers a booking hold AND a pending extension. The paid webhook tested the hold first, passed it to new-booking confirmation, and rejected its missing booking metadata. Its automatic refund neither recorded an extension payment nor released the hold. The terminal webhook also incorrectly treated this normal pair as ambiguous. This explains BetterQA's charged/refunded attempts, unchanged booking end, invisible transaction history, and temporarily blocked retries.

Route by the trusted pending-extension registration before the new-booking hold path. Keep existing atomic `apply_paid_booking_extension` as the entitlement authority: it checks the exact reserved interval, holds the listing lock, records the payment, extends hours, and releases the hold together. Register the expected connected account and amount on new extension holds.

Inspect current account-scoped PaymentIntent, captured Charge and complete refund history before applying time. Refunded, refund-pending or disputed payments never grant an extension. Add `booking_extensions.application_state` to distinguish applied parking time from rejected payment audit rows independently of financial refund state.

The service-role-only rejection RPC follows the same pending/listing/booking/hold lock order as application. It records the owned payment and releases only its matching hold in one transaction, without changing booked hours. It refuses an already-applied extension. Commit this rejection marker before requesting a refund, then persist current Stripe refund history with the real Checkout event ID. Retry uses the existing integrity-refund idempotency key, never issues an additional refund for already settled/pending refunds or disputes, and never grants time to a rejected checkout. Database/provider outages return an error for retry rather than refunding based on missing evidence.

The terminal RPC atomically removes the trusted unpaid extension registration and its matching hold after the HTTP handler verifies fresh terminal Stripe state. It recognizes legacy holds with no account snapshot only through the exact server-owned pending/parent/session relationship. Applied/rejected payments are protected against late terminal cleanup.

Transactions shows rejected payments as “Extension not applied,” with the existing refund totals/status. Booking cancellation continues to require support for applied extensions and unresolved rejected-extension money, while a fully refunded rejected payment does not permanently block original-booking cancellation. QA readiness requires the new column.

## Historical attempts

The additive migration changes no booking hours, creates no charges/refunds, and does not blindly backfill or delete pending records. For old Stripe-only integrity refunds, redeliver the affected signed `refund.created` / `refund.updated` event to the QA webhook (or the original paid Checkout event). Refund recovery verifies the current refund, Checkout, captured Charge, account and trusted registration before creating the missing rejected-payment audit and releasing its own hold. The normal refund ledger then records the actual refund. Already-applied payments and unrelated accounts are excluded. Recovery itself creates no refund.

Specific historical attempts cannot be claimed reconciled until their signed Stripe test events are replayed and verified. Preserve the affected booking/session/refund/event references in the private ticket; do not put personal/payment identifiers in public logs or PRs. Expired reservations no longer block availability, but that alone does not repair their missing history.

## Verification and QA acceptance

The pre-fix dispatcher fails the new both-records regression. Focused tests exercise actual dispatcher/confirmation logic with synthetic provider/database boundaries, current-refund guards, retry failures, cleanup and recovery. The existing real signed HTTP/email-delivery test now includes both hold and pending extension records and mocks current Stripe money, retaining booking/extension email coverage. Disposable database tests cover journal/hold rollback, exact ownership, same-hour retry, service-role access, rejection/application races and replay. The captured PostgreSQL 17 schema rehearsal installs this migration and exercises rejected payment/refund history plus successful retry with service-role permissions.

Before QA deployment: full tests/build, native database CI, complete captured-schema rehearsal, exact candidate tree verification, QA-only migration, and exact-SHA Vercel deployment. Record final evidence in the PR.

BetterQA should retest PARK-TC-067 on a fresh valid active booking using Stripe TEST mode: +1h advances the end time in My Bookings and Host bookings, creates one extension charge/transaction, and is not refunded. Repeat payment webhook delivery must not add another hour. For BUG-005260, a rejected/refunded attempt must leave booked time unchanged, show its charge/refund in Transactions, and allow retrying the same available hour; another customer's legitimate reservation must remain blocked. Verify expired/cancelled checkout cleanup, repeated extensions from the updated end, and the relevant old Stripe-only attempts after their event replay. Actual browser/Stripe acceptance remains a separate QA test.
