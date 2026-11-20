# QA follow-up: scheduled extension and review timing

Code-identified follow-up to the booking-timezone/extension/review repairs; no separate BetterQA ticket ID. Stacked on PR #195 and the earlier QA repair stack. QA only, no main merge or actual production promotion.

## Defect and change

`create-extend-session` and `reviews` omitted `scheduled_starts_at` from their explicit booking projections. Both call the shared `getSessionWindow`, which correctly prefers that immutable saved instant when it is present. The missing column caused the API to fall back to interpreting the property's scheduled date/hour as UTC.

For a Toronto booking on 20 October from 09:00–11:00 local time, the true window is 13:00–15:00 UTC. At 14:00 UTC the old extension precheck treated the booking as ended, although the booking and database extension hold considered it active. A review just before 15:00 UTC could incorrectly pass the old completion check. For Bucharest's 09:00–11:00 booking (06:00–08:00 UTC), a valid active extension could be blocked and an eligible review delayed until 11:00 UTC.

Both bounded booking queries now include the saved instant and property zone. The existing canonical-time calculation, transactional extension hold, fees, payment validation, authorization, unique-review rule and historical fallback remain unchanged. There is no data migration, historical timestamp reinterpretation, backfill, new dependency or frontend change.

## Verification

`test/qa-canonical-booking-actions.test.js` imports the actual authenticated HTTP handlers and real Supabase query builders. Synthetic HTTP responses project only requested columns, so a fixture cannot hide an omitted column. Every outbound request is intercepted; Stripe account/checkout calls are local spies only. The old code fails 9 of the 19 scenarios; the repaired code passes all 19.

Coverage includes active Toronto/Bucharest scheduled extensions, midnight, unambiguous starts spanning DST transitions, exact start/end boundaries, review just before/at the actual end, already-paid extension hours, invalid stored instants, legacy UTC and Book Now fallback, missing authentication, unrelated Driver ownership, Host self-review rejection, existing amount/connected-account handling and duplicate-review conflicts. Starting a checkout does not add booking hours before payment.

Require the full native regression/build workflow and PostgreSQL 17 full-schema workflow on the exact commit before deployment. No hosted account, listing, booking, review, checkout, charge, refund, Storage operation or notification is created for verification. BetterQA's signed-in Stripe TEST acceptance is still required.

## BetterQA retest

1. During an active scheduled Toronto booking, request an available additional half-hour. Confirm extension checkout opens, shows the expected amount and applies time only after successful Stripe TEST payment. Repeat at a verified Bucharest listing with a remote browser timezone.
2. Before a scheduled booking starts and at/after its actual end, verify additional-time checkout is refused. Existing capacity, spot and hold conflicts must still block payment.
3. Attempt a review before the actual scheduled session ends: it must be rejected. At/after its actual end, an otherwise eligible Driver can submit one review; another review remains a conflict. Include a booking whose paid extension moves the end later.
4. Recheck ordinary Book Now extensions/reviews, Host self-review denial and another Driver's access denial. Compare against dashboard times and the saved booking interval, rather than an assumed UTC interpretation of local hours.

## QA release and rollback

Deploy only Vercel QA project `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC`, stable https://parkshare-qa.vercel.app/parking, at the exact native-tested commit. Check all release-readiness flags, public browse and signed-out denial on both changed endpoints. Recheck existing QA record counts/full booking and listing digests, and confirm the separate production deployment is unchanged. No Supabase migration is needed.

Rollback is a QA redeployment of previous commit `a7d372ce174cd35bc9fd9770f71a33fc2509d32c`; keep all existing database migrations and publication receipts. Reverting restores the old scheduled-action timing defect and should only be used if the release develops a regression.
