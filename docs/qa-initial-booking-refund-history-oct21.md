# Initial-booking conflict refund history — 21 October 2026

Code-identified issue; no BetterQA ticket ID has been assigned here. This is the initial-booking path, separate from the extension settlement repair in PR #220.

## Failure and repair

Previously, if a paid initial booking failed its spot-exclusion insert, the webhook requested an automatic refund and deleted the hold. It returned success without saving any booking/payment owner for the charge. Transactions reads paid booking/extension records, and refund reconciliation requires one of those owners, so the charge/refund could remain Stripe-only. Replay after hold deletion could not complete the missing audit.

Use one service-role-only PostgreSQL settlement function to serialize the initial booking decision on the listing lock. It validates the registered hold/payment snapshot, checks capacity/spot conflicts including other live holds, then either confirms the booking or inserts a paid financial audit with `application_state='rejected'`, `status='payment_failed'` and its rejection reason. A late exclusion violation also falls back to the rejected audit. Hold consumption commits in the same transaction. Failure to write the audit or delete the hold rolls everything back, before a refund is requested. Rejected rows cannot have confirmed/completed status.

Read current captured Stripe money/refund history before this decision. An already-refunded, refund-pending or disputed payment cannot create a new booking. The shared read helper retains the previous extension API, so extension money checks use the same verification and timeout policy.

Only after the durable rejected outcome exists, request the conflict refund using the original `booking-conflict-{session}` key and request parameters, then reconcile complete current refund history with the real signed Checkout event ID. An existing settled/pending refund or dispute does not initiate another refund. A provider/ledger outage returns webhook 500; replay resumes through the rejected payment even though its hold is gone. Confirmed bookings still send confirmation once; rejected attempts send none. Transactions labels the financial attempt “Booking not confirmed” and distinguishes pending and settled refunds using the existing ledger totals.

## Scope and historical limits

The migration adds columns/constraints and a service-only function; it does not rewrite historical booking times, amounts, statuses or financial rows. Existing rows default to the pre-existing applied state. Only the QA database/project is an authorized deployment target. Preserve the previous QA deployment for application rollback; do not drop audit columns or rewind financial rows after new events arrive.

This repair covers trusted initial checkouts that reach settlement, including capacity/spot conflicts and current payment reversals. Legacy integrity-rejection handling for malformed checkout snapshots remains separate. Older conflict attempts whose holds were already deleted have no trustworthy server registration available to this new path; they are not automatically backfilled. Such Stripe-only attempts require the affected private payment references and individual reconciliation. No real charges/refunds, historical replay, mail send or customer-account action is part of this repair's verification.

## Validation and BetterQA acceptance

The new signed HTTP regression fails against the pre-fix webhook. Synthetic provider/database boundaries cover successful confirmation, conflict audit-before-refund, replay, already reversed/disputed payments, pending versus returned refunds, provider/ledger outages, invalid signatures/accounts and Transactions output. Existing real signed HTTP/email transport tests still deliver normal booking and extension emails.

Disposable native PostgreSQL tests cover duplicate/competing deliveries, preservation of other holds/bookings, unlabelled capacity, identity tampering, rejection replay after conflicts disappear, audit/hold rollback, late exclusion exceptions and execution grants. The captured PostgreSQL 17 full-schema rehearsal applies the migration, exercises the function with service_role, and persists pending then succeeded refund snapshots without granting parking time. Run the full suite/build and exact-tree CI before QA-only migration/deployment; record final evidence in the PR.

BetterQA should use Stripe TEST mode to verify: a valid new booking confirms once with a normal Transactions entry; a payment that loses its intended spot records “Booking not confirmed,” releases only its own hold, requests one refund and shows actual pending/settled amounts; repeated signed deliveries do not duplicate money or confirm rejected bookings; another Driver's valid reservation stays intact; a temporarily failed webhook/ledger write can recover by replay. Recheck extensions, existing booking cancellations and ordinary refund history. Independent browser/Stripe acceptance remains pending until BetterQA reports results.
