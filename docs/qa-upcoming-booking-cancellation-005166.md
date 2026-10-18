# BUG-005166 — Upcoming booking and cancellation canonical-time read repair

Draft follow-up to unified candidate PR #182, base commit
`5427aade04880a1a11b2473beaebd1bf9a97ffee`. Not deployed.

## Confirmed code defect

The canonical timezone implementation stores `scheduled_starts_at` and
`property_time_zone`, and both browser `clientBookingWindow()` and server
`getSessionWindow()` already prefer the canonical start. However:

- `/api/account-bookings` omitted both fields from its explicit projection,
  affecting Driver and Host dashboards.
- `/api/cancel-booking` also omitted both fields before evaluating eligibility.

Both consumers consequently fell back to legacy UTC wall-clock interpretation,
even for a correctly stored canonical booking. In the synthetic regression,
Toronto October 20 at 14:00 is stored as 18:00Z. At noon Toronto (16:00Z), the
old reads treat the reservation as 14:00–15:00Z: already completed, and too
late to cancel. Forwarding the stored fields preserves the actual future slot.

This demonstrates an additional integration defect in the draft candidate.
It does not establish the exact row/root cause in BetterQA's original report.

## Change

Include the existing canonical start and property timezone in both projections.
No new schema, refund policy, fee, booking mutation or timezone inference.
Keep authentication, ownership checks, extension support restrictions, refund
idempotency and the confirmed-status update guard unchanged.

## Verification

The new 12-case suite executes the actual authenticated API handlers using
the installed Supabase client with all HTTP intercepted locally. Stripe refund
creation is a local spy; no real auth, payment, refund or customer action occurs.
Actual browser window/display functions are executed from the application source.

- Driver/Host booking payload preserves canonical start and property display.
- Two-hour notice and exactly one-hour Driver cutoff allow cancellation.
- Below one hour, at start and after end reject without initiating a refund.
- Host cancellation before start remains allowed inside the Driver cutoff.
- Repeat cancellation does not request another refund.
- Unrelated account cannot list or cancel the reservation.
- Legacy UTC behavior and Book Now support policy remain unchanged.
- Invalid canonical values fail closed before initiating a refund.

Against the unpatched base, 7 of the 12 regressions fail. With the read repair,
all 12 pass. The local application regression run passes 342 tests; database
service tests require the native CI PostgreSQL service. The application build
and native CI results must be checked on the published draft commit.

## Deployment and ticket limits

This branch depends on PR #182's canonical schema/client/API/privacy changes.
Do not deploy these reads to the old active schema without that coordinated
release. No additional migration is introduced here. No merge, active QA
promotion, hosted SQL, Stripe action or production change is authorized.

Historical paid reservations with NULL canonical starts still retain their old
recorded UTC interpretation. This patch deliberately does not backfill or shift
those reservations. BetterQA must identify the reported booking and reconcile
the original selected local time, Stripe evidence, stored range and any overlap
before a separately reviewed data repair. Do not mark BUG-005166 resolved from
these automated results alone.

## BetterQA retest after the coordinated release

1. Create a new Toronto scheduled booking at 14:00 with verified property zone;
   confirm the hold, stored canonical booking and reserved interval all use
   18:00Z in October. Repeat from an Athens browser and a Toronto browser.
2. At noon Toronto, verify Driver and Host both show Upcoming, the displayed
   time is 14:00 property time, and the appropriate Cancel control is available.
3. Use Stripe TEST to exercise Driver cancellation with two hours and exactly
   one hour notice, and verify a single connected-account refund, correct
   booking state and release of the original spot interval.
4. Check below one hour, at start, after end, Host cancellation, extension
   support restrictions, duplicate clicks and wrong-account denial.
5. Reconcile and retest the original historical booking separately. Preserve
   paid records; do not relabel or reschedule them solely to pass the test.
