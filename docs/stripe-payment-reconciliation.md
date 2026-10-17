# ParkShare | Stripe Checkout reconciliation runbook (read-only)

**Status:** Draft for controlled operator/BetterQA review — October 17, 2026. No Stripe payment, refund, webhook resend, DB migration, or production deployment is authorized by this document.

## Observed production facts, 2026-10-17

- Vercel's **production custom-domain** deployment logged `checkout.session.completed` handler failures during October 14–16. Some were Postgres FK `23503` because the Stripe event referenced a missing `listings` row or missing `profiles` row in **production**.
- Vercel grouped 84 webhook error occurrences over the observed 7-day window. **An occurrence is not a unique paid customer/session.** Stripe retry deliveries can repeat the same failed event.
- **Production** Supabase had 27 bookings (24 confirmed, 3 refunded), with 27 distinct Checkout Session identifiers; all 27 rows have a PaymentIntent and valid listing/renter FK references. Last created booking was October 11. None were created October 14–16.
- The QA Supabase project has listing IDs 4 and 16; neither exists in production. This suggests checking for **test/QA events delivered to the production webhook**, but does **not** prove the same events belong to those QA listings.
- These observations do not prove whether any October 14–16 charge succeeded. **Do not mark the incident resolved until the Stripe records are inspected.**
- Production booking foreign keys still use **ON DELETE CASCADE** for listings and Driver profiles, which can erase related payment history when a parent row is deleted. QA has already changed the listing FK to **ON DELETE RESTRICT**. Do **not** perform production deletions or migrations as part of this audit; schedule a separate review of booking-history retention and the migration rollout.

## A. Inspect Stripe webhooks — no changes

1. Open Stripe Dashboard → Developers → Webhooks / Event destinations, and choose the relevant **test** or **live** mode.
2. Identify every endpoint pointed at `https://www.myparkshare.ca/api/stripe-webhook` and at the QA endpoint. Check whether it receives **Connected account** events, not only platform events.
3. Open failed `checkout.session.completed` deliveries dated October 14–16 UTC. Capture internally: event ID, delivery attempts/status, `livemode`, `account` (connected account ID), Checkout Session ID, PaymentIntent ID, payment status, amount/currency, and metadata `listing_id`, `renter_id`, `hold_id`. Avoid copying customer details or secrets into a public issue.
4. Verify whether the session is **paid**, and whether its metadata refers to **QA vs production**. If paid and no booking exists, escalate urgently for human-directed reconciliation. If no successful charge occurred, do not report lost customer money.
5. Do **not** press Resend or refund buttons during investigation. A valid retry of a real paid session can produce real side effects. Coordinate approved remedies after tracing unique payment and refund identifiers.
6. Test and live webhook signing secrets are different; use the correct endpoint secret for each destination. Verify Connect event account and environment explicitly.

## B. Optional programmatic cross-check (operator machine only)

Use the isolated read-only command, **not** a public API route:

`node scripts/audit-stripe-checkout-events.mjs --db=prod --stripe-mode=live --from=2026-10-14 --to=2026-10-17`

Run a **separate** invocation for production Stripe test events:

`node scripts/audit-stripe-checkout-events.mjs --db=prod --stripe-mode=test --from=2026-10-14 --to=2026-10-17`

And, if applicable, a separate QA/test comparison:

`node scripts/audit-stripe-checkout-events.mjs --db=qa --stripe-mode=test --from=2026-10-14 --to=2026-10-17`

**Important:** These are examples, **not executed results**. `--to` is the exclusive UTC end date. Restrict a report to 14 days. The script reads Stripe's Checkout completion events (including Connect event metadata when present), and reads only the minimal booking and reference records from the selected Supabase project.

- Requires a secured operator environment with `STRIPE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. **Never paste secret values into ChatGPT, GitHub, tickets or public logs.** The script checks the database URL against the chosen project and the Stripe key against test/live mode.
- It never creates charges, initiates refunds, replays events, alters records, or emails customers.
- It prints an aggregate JSON report and identifiers for internally reconciling flagged sessions. Handle that report as sensitive operational data; **do not commit it to GitHub**.
- The tool does not retrieve event history older than Stripe retains (typically 30 days), and must not claim complete coverage if the configured event stream excludes connected-account events or contains more than its event limit.
- A report with zero problems is **not proof** of full reconciliation; compare Stripe payments/charges, connected accounts, webhook destinations, and any deleted accounts not visible to the platform event listing.
- Missing booking/reference, checkout amount/account mismatch and payment-mode mismatch are blockers for manual review; a previous refund is flagged for review rather than a new automatic refund.
- Do not run this script in Vercel production functions; it is explicitly an administrator's controlled read-only audit.

## C. Decision table

| Stripe payment / booking | Next step |
| --- | --- |
| No completed/paid payment, no booking | No charge to reconcile; examine failed attempts and timing |
| Paid session, matching booked record | Verify correct Host account, amount, confirmation email and any refunds |
| Paid session, no booking; listing/renter exists | Escalate; diagnose webhook processing and hold/booking conflicts; no blind replays |
| Paid session, no booking; listing/renter missing | **Highest priority:** confirm event environment, trace original record and charge, then agree on customer remedy |
| Paid session tied to QA/test but delivered to production | Correct webhook endpoint/destination and signing-secret separation in a controlled change window; do not replay into production |
| Paid session with refund/dispute already recorded | Verify Stripe amount/status and prior action before doing anything new |
| Any case with unknown payment mode/account | Stop until Stripe event detail resolves ownership |

## D. Release gates

- [ ] Verify unique paid sessions versus deliveries, separately for Stripe test and live.
- [ ] Reconcile every paid event in the selected period with the right Supabase project and Host connected account, including extension payments.
- [ ] Confirm no missing paid bookings, unresolved refunds or double charges.
- [ ] Document webhook endpoint separation and signing secrets without exposing values.
- [ ] Confirm independent BetterQA regression tests pass before promoting changes.
- [ ] Release only after a coordinated maintenance window; monitor successful deliveries and customer confirmations.

**Record each unresolved case in a private finance incident register.** Do not include customer email addresses, payment credentials, full Stripe payloads, or service-role values in public GitHub issues.
