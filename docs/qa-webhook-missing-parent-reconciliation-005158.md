# BetterQA BUG-005158 — Production missing-FK payment reconciliation safeguard
**October 18, 2026 · stacked review-only draft following PR #166 · NOT deployed**

## Problem and evidence
- The original BetterQA first-delivery failure in QA involved intermittent 522/504 Supabase gateway reads; draft PR #166 handles those as transient **read errors**, not payment fraud.
- A **separate** group of production `checkout.session.completed` webhook errors includes PostgreSQL SQLSTATE **23503**, indicating booking insert referenced a missing foreign-key parent. Earlier Vercel log sampling reported **84 error occurrences**, not 84 separate paid sessions, charges or refunds. A new direct Stripe event investigation is still required to identify any impacted paid transaction.
- Read-only data checked October 18: QA has **27** stored bookings, production **28** (one more than the previous October 17 snapshot of 27). **Neither dataset contains currently orphaned listing/renter references.** Both have **zero unexpired holds**. These aggregate facts do not identify which Stripe events failed or whether the extra production booking was paid.
- Both databases enforce booking foreign keys. **Production** listing deletion still has `ON DELETE CASCADE`, while QA uses `ON DELETE RESTRICT`. This schema difference requires its own controlled retention review: deleting a production listing can erase financial booking history even though existing rows naturally show zero orphan references. Nothing was deleted or altered during this work.
- It remains an **unconfirmed hypothesis** that a misrouted QA/Stripe environment or a parent deleted between checkout and webhook explains the production 23503 failures. Do not claim a specific root cause without reviewing the actual signed Stripe events and their connected account/mode.

## Confirmed code-level risk and prepared repair
The existing `hostAccountForListing` implementation treated `PGRST116` (paid Checkout listing/Host missing) as `CheckoutIntegrityError`. `processPaidCheckout` catches that class and initiates an **automatic Stripe refund** for the signed paid registered session. But missing DB parents do not, by themselves, prove the payment was fraudulent or should be automatically refunded.

Stacked PR:
- New pure `api/_paid-checkout-reference.js` defines a typed `PaidCheckoutReferenceError` **separate** from refundable `CheckoutIntegrityError`; normal FK SQLSTATE `23503` becomes a reference error. Neither missing parent nor FK violation initiates automatic refund or synthetic parent creation.
- Host listing, Host profile and Stripe-account availability now distinguish missing records/configuration changes from verified payment-integrity mismatches. Listing and Host lookups still use PR #166's bounded *read-only* transient-Supabase retry; outages and permissions problems propagate normally.
- Before inserting a verified paid booking, explicitly check the `profiles` parent for the authenticated Driver ID **stored in the trusted Checkout hold**. A missing Driver is flagged without blindly inserting an FK-violating row.
- `confirmExtension` similarly distinguishes an absent parent booking from account/amount/tamper mismatches. (Separate extension atomicity and hold corrections are PRs #160 and #174; not integrated/deployed here.)
- If a booking insert still returns `23503` due to a race, event mismatch or an otherwise inconsistent parent, convert it to an operator **paid-reference reconciliation** error, **not** an automatic refund.
- For these reference errors, signed webhook logs contain fixed-stage code plus **event ID, Checkout Session ID, Stripe connected account ID, event mode and type**. No Host addresses, customer emails/plates, raw payment metadata or database exception body are logged by this path.
- The webhook deliberately returns **HTTP 500** so Stripe may retry. It never acknowledges unconfirmed payment with HTTP 200, does not create placeholder profiles/listings, does not delete the registered hold, and does not automatically refund a payment based merely on missing references.
- Genuine **verified** charge/account/amount mismatches still follow their existing `CheckoutIntegrityError` and idempotent-refund path. Existing separate `23P01` double-booking conflict refund handling is unchanged.

## Automated verification
- JavaScript tests cover PGRST116 missing parents, genuine errors left untouched, `23503` classification and other SQL states, privacy-safe log payload, and webhook branch sequencing/security.
- Disposable PostgreSQL tests create one valid booking and reject direct inserts referencing missing listing/renter, observing true SQLSTATE 23503 while leaving no confirmed booking.
- Run GitHub Actions/preview checks and independently verify final commit. **No real Stripe TEST/live webhook or database write was performed against actual ParkShare services.**

## What BetterQA needs to investigate (READ-ONLY first)
1. Supply the **first failed Stripe TEST `checkout.session.completed` event ID**, event mode, connected account ID, Checkout Session ID, and timestamp. Do not paste API keys, payment card numbers, addresses or private customer data in the ticket.
2. Compare with Stripe's signed event destination and actual payment success/refund state; check whether QA events were routed to production. This is a hypothesis, NOT an established finding.
3. Cross-check the trusted `booking_holds` record, listing ID, Driver/Host profile parents and Stripe account ID **in the intended Supabase project**, without creating/moving production records.
4. Determine which **FK constraint** actually failed (`bookings_listing_id_fkey`, `bookings_renter_id_fkey`, etc.). A missing listing vs missing Driver leads to different remediation.
5. In an approved disposable Stripe TEST/isolated QA setup, inject a missing listing/Host/Driver parent or a late parent deletion, and verify: no booking insertion, no automatic refund, no false HTTP 200, structured audit log and HTTP 500/retry behavior.
6. Confirm genuine wrong Host/amount/currency still triggers existing strict integrity policy; transient 504/522 and unrelated DB errors do not initiate refunds.
7. Manually reconcile any **genuinely paid** orphaned Checkout against verified Stripe events and retained Postgres hold snapshots with BetterQA/support. Determine whether to restore legitimate parent/booking or refund, according to approved policy and customer notification. **No automatic backfills or refunds.**
8. Integrate this stacked branch with PRs #156 (read-only Stripe reconciliation), #160/#174 (atomic extensions) and #143/#166 (integrity/transient read handling) in an approved staged release branch.

## Limits and rollout
- This is a **safeguard against an erroneous automatic refund and an improvement to incident traceability**, not a demonstrated fix to every production 23503 occurrence. Missing parents will continue to return HTTP 500 until operators reconcile the source cause.
- There is no new database migration in this PR. Any deletion-policy changes or forensic data restoration belong to a **separate authorized release**.
- **Do not merge or deploy to active QA or production, apply migrations, replay Stripe events, run payment/refund actions or modify original production records.**
- Keep BUG-005158 open until independent BetterQA Stripe TEST end-to-end verification and reconciliation of actual affected event IDs.

