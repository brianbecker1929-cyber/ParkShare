# BUG-005324 — extension checkout, totals and bay counts

The QA baseline already copies the authoritative listing Host on the Driver's
extension-confirmation email. Retain and regression-test that behavior.

## Changes

- New extension cancel URLs carry the server-created hold UUID. The authenticated
  return handler verifies the owner's hold, pending registration, booking,
  connected account, exact amount, duration and bay. It retrieves, expires and
  re-retrieves the unpaid Stripe session before calling the existing atomic
  `release_unpaid_extension_checkout` procedure. Payment/expiry races and provider
  or database failures never claim successful release. No charge/refund is made.
- Account booking reads sum paid, applied extension amounts for only the current
  Driver's bookings or the current Host's listings. Both dashboards display the
  resulting `charged_total`; original booking totals, financial ledgers and refund
  bases stay unchanged. Rejected/unpaid extensions cannot inflate the total.
  Reads are paged to avoid the Data API's default row cap truncating history.
- The API and authoritative hold/payment procedures count each labelled physical
  bay once across bookings and extension holds. Unlabelled historical records
  remain separate. The migration replaces only two reviewed capacity expressions
  and refuses unexpected procedure definitions. Existing lock ordering, quotas,
  spot conflict checks, security settings, owners and grants are preserved.

## Release gates

Run the regression suite and build, native PostgreSQL capacity/race tests, and
the full captured-schema rehearsal. Apply migration
`20261025151011_deduplicate_extension_spot_capacity_005324.sql` to ParkShare-QA
only after those gates pass; it changes procedure calculations, not table data.
Deploy the reviewed commit to Vercel project `parkshare-qa` and verify its alias.
Do not merge this QA release into the production/main branch.

## BetterQA retest

1. Use a NEW, active paid TEST booking, then buy one extension. Verify additional
   time applies once and the Driver receipt copies the actual Host (Inbox/Spam).
2. With an original CAD 34.50 charge and CAD 17.25 applied extension, both My
   Bookings and Host Dashboard must show CAD 51.75. Confirm Transactions still
   records the original and extension separately, without duplicate earnings.
3. Start another extension and use Stripe's Back/cancel link without paying.
   After authenticated cancellation verification, the hold for ONLY that unpaid
   extension must disappear. The original/previously extended booking stays paid
   with the same confirmed end time. Reload and repeat cancellation safely.
4. On a three-bay listing with a booking and its adjacent extension hold on A,
   browse a window crossing both intervals: two bays must remain free, consistent
   with the map. Confirm B can actually be booked; A remains unavailable.
5. Exercise another Driver/account, paid-session/expiry races, failed provider or
   database responses, mobile layout and multiple extensions. Failure must keep
   an actionable retry/status message and must not release paid parking.

Closing the browser without returning through Stripe's cancel URL cannot trigger
authenticated cleanup; that hold continues to its normal timed expiry. Old open
Checkout links do not gain the new return reference. No historical payment,
refund, booking total or already-sent email is rewritten.

Passing automated checks establishes readiness for QA retesting, not a completed
live Stripe/email end-to-end retest.
