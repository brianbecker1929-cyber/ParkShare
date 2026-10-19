# BetterQA outstanding six-bug repair — 19 October 2026

Scope: QA only, stacked on the complete prior QA release and multiple-refund ledger repair. No merge into main and no production promotion.

## Repairs and retest

| Bug | Change | BetterQA acceptance check |
| --- | --- | --- |
| BUG-005163 | Both confirmation recipients use the booking's saved property timezone and a dynamic label. | New Toronto booking tomorrow 09:00–11:00: check Driver/Host emails, dashboards, actual saved instants, cancellation before start. |
| BUG-005221 | Book Now retains the server-owned property timezone from checkout through the webhook. Empty schedule hours remain null. All notification types use the same verified zone. | New Book Now at the reported Cluj property (verified Europe/Bucharest), browser in Romania: compare payment time, both dashboards and both confirmation emails. Repeat with a remote browser timezone. |
| BUG-005223 | Schedule for Later defaults to tomorrow 09:00–11:00 in the property's calendar. Availability exposes a returned validation reason rather than describing invalid input as an outage. | Switch after 09:00 local time; leave default unchanged; availability must succeed when the listing's schedule allows. Manually choose a past slot and confirm the future-start validation. |
| BUG-005220 | Public discovery uses a server-only SQL function, 50-row keyset pages plus one lookahead, a fixed column projection, at most eight spot flags, aggregate ratings via the existing listing-leading review index, and no photos/geometry. All account states use the same public API. Aborted refreshes cannot overwrite the latest result. | Repeated signed-in refreshes and Try again on /parking; expect GET /api/public-parking 200 with small responses. No raw Supabase listings reads. With >50 listings, Load more must retrieve subsequent pages without duplicates. |
| BUG-005222 | Role and Disclaimer retain the accessible Close button; dismissal clears pending credentials and agreement. Account creation remains after consent. | Close on both steps; browse, then open /my-bookings and /profile directly. No modal until explicitly reopened. No account created by cancellation. |
| BUG-005211 | Map idle publishes its actual centre for Nearest sorting. Camera-fit identity ignores listing order so sorting does not reset a pan. | My Location inactive: pan near a non-first listing, select Nearest, verify order changes correctly and map remains panned. Repeat destination, device-location and price/rating sorts. |

BUG-005162 and BUG-005164 remain in the existing QA stack and should also be retested on this release.

## Validation and limits

Automated checks exercise the actual JSX for dismissal, map behaviour and sorting; Toronto/Bucharest booking/display/email formatting; DST/device-calendar boundaries; bounded endpoint pagination and repeated public refresh calls. Synthetic signed Stripe webhook and cron transports deliver all five notification templates without real payment or email actions. The disposable PostgreSQL 17 full-schema rehearsal includes 123 synthetic large-photo listings and ACL checks for the new RPC.

The new migration only creates a service-only read function. No historical booking timestamp, payment, refund, extension, availability or storage records are rewritten. Existing bookings with no timezone snapshot use explicitly labelled UTC in emails; their original instants remain unchanged. Listings without a verified timezone still cannot accept scheduled checkout; the repair does not guess zones or coordinates. Historical incorrectly stored reservations require separate evidence and individual review.

Manual acceptance still requires BetterQA's signed-in Stripe TEST booking and inbox checks. Automated mocked delivery is not live email verification. No customer accounts, charges, refunds, reminders or emails are created by this repair workflow.

## Release procedure

1. Run the Node suite and Vite build; require native CI Tests and PostgreSQL 17 full-schema rehearsal success.
2. Apply only `bounded_public_parking_005220` to QA database `biydlfekindgaslgktsx`; verify record counts/booking digest are unchanged and anon/authenticated cannot execute the RPC.
3. Deploy the exact tested commit only to Vercel project `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC` (`parkshare-qa`).
4. Verify release readiness (including `boundedPublicParkingReady`), feed status/size, booking endpoint authorization and public UI. Recheck the separate live production deployment is unchanged.

Rollback: redeploy the previous QA commit `d299554dea8b0524442b868e963cfe9f37a17919`; the additional read-only RPC may remain installed. Do not rewind financial data or drop the prior refund ledger.
