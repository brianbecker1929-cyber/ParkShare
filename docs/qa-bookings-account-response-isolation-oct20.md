# QA follow-up: My Bookings response isolation across account changes

Code-identified privacy defect; no separate BetterQA ticket ID. QA only, stacked on PR #196 and all earlier repairs. No main merge or actual production promotion.

## Defect and repair

My Bookings started an asynchronous session lookup, booking request and individual private-cover requests on user changes without cancelling or invalidating previous work. Switching from Driver A to Driver B while A's request was delayed could let A's late response overwrite B's cards with A's driveway address and vehicle details. Old cards and action-dialog state also remained in the reused view until the next load completed. This is a browser response/state race; it does not demonstrate a backend authorization bypass.

The bookings view is now keyed by the authenticated account ID so account changes synchronously replace cards, date filters and cancellation/review dialog state. Its loading effect resets the read state, checks that the retrieved session belongs to the requested account, and runs only for account-ID changes. Cleanup aborts booking and private-cover requests and marks their results inactive. Late booking JSON, errors, session results and private-photo responses cannot update the view even if an underlying transport ignores abort. Session lookup failures and malformed responses end loading with the existing error state.

`fetchPrivateCoverDataUrl` accepts an optional AbortSignal. Existing callers retain their behaviour. Backend participant checks, bounded booking payloads, private photo authorization, booking/extension/refund rules and historical data remain unchanged. No migration or dependency change is required.

## Verification

Ten regression checks execute the actual extracted My Bookings loading effect, its real browser booking-date/display functions and the compiled JSX account key. Controlled promises reproduce the old failure: after B's successful load, A's late response changes the visible address to A's private address. The two primary old-code tests fail; all ten repaired scenarios pass.

Coverage includes immediate reset before the new response, late previous-account success/error/photo responses, account/session identity mismatch, unmount during session lookup or JSON parsing, malformed payload/HTTP/session failures, current-account details and private covers, stable account-ID dependencies, and React keys that reset account-owned cards/filters/dialogs. No real accounts, sessions, bookings or photos are used. Require full exact-commit native tests/build and PostgreSQL 17 full-schema rehearsal before QA deployment.

## BetterQA acceptance

1. With disposable Driver A and Driver B, throttle or delay A's My Bookings response. Change accounts in the same tab or through the existing cross-tab session flow while the request is pending. Once B is active, only B's bookings, vehicle details, addresses and photos may appear, including after releasing A's old response.
2. Delay private-cover responses separately, switch accounts or leave My Bookings, then release them. No old photos or stale errors should replace the current view.
3. Open a date filter or cancellation/review dialog on A, then switch to B. My Bookings must start with B's own fresh cards and default view/dialog state. This change does not broaden the scope to independent global messaging/navigation/extension overlays.
4. Check a normal current-account load, empty account, unavailable network/session, sign-out, and re-entry into My Bookings. Verify current-account booking details, authorized covers, date filters and cancellation/review actions still work.

Use synthetic QA accounts and bookings. Existing backend account/participant authorization remains a required regression check. Automated race simulation is not a signed-in browser acceptance result or evidence of a historical disclosure.

## Release and rollback

Deploy the exact native-tested SHA only to QA Vercel project `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC`, https://parkshare-qa.vercel.app/parking . Verify all readiness flags, public browse, signed-out booking/photo denial and unchanged QA record counts/full booking and listing digests. Confirm the separate actual production deployment remains unchanged. No Supabase migration is applied.

Rollback is a QA redeployment of previous commit `fb46d1d45705b3139e19e61c9005efc10eb39186`, keeping all existing database migrations/receipts. Reverting restores the stale-response defect; review the impact before rolling back. Never rewind application or financial data.
