# QA follow-up: original booking checkout account and request isolation

Code-identified initial booking checkout defect; no assigned BetterQA bug ID. QA only, stacked on PR #208 and all prior fixes. No merge into main or actual production promotion.

## Defect and repair

The initial booking Pay handler lacked a synchronous pending lock and did not compare its returned/refreshed session owner with the Driver reviewing the booking. It checked whether the modal remained mounted only before redirect, so closing during delayed authentication could still start a new checkout POST/hold. Close did not invalidate queued callbacks until React unmounted. A session change while the API created checkout could also redirect the browser to the previous account's checkout. Vehicle switching remained active during the request.

Each dialog is now keyed to its account, listing/title/rate, duration, selected spot, local date/time, selected vehicle ID/details and event. Changing that selection invalidates the old owner/attempt; a same-account profile rerender with unchanged booking/vehicle fields preserves legitimate work. Close invalidates callbacks synchronously. Unmount and StrictMode cleanup invalidate old attempts; setup unlocks a fresh attempt.

Pay captures its JSON payload before waiting for authentication and locks synchronously before its first await. Both initial/refreshed sessions must match the original account before POST. Current dialog/attempt checks follow each await, and stored session ownership is checked again immediately before navigating to the API's hosted checkout URL. Late success/errors cannot redirect a closed/replaced dialog or update its UI. Vehicle switching is disabled while pending, with handler guards for queued clicks. Current failures show accessible errors and unlock explicit retry. A successful redirect keeps the pending lock; no automatic POST replay occurs.

Server-owned price, vehicle resolution, spot/capacity/hold rules, timezone interpretation, webhook fulfilment, fee calculation and payment handling are unchanged. Starting Stripe checkout is not a paid booking: the real flow still does not call the demo success callback. A checkout POST already sent may still create a Checkout Session/hold after leaving or signing out. This UI fix does not recall it, cancel/expire server sessions/holds, reverse charges, create global server idempotency or atomically revoke sessions. An SDK refresh already started can finish; the UI does not alter SDK internals. Confirm My Bookings/Transactions after an unknown payment outcome before starting another checkout. Existing backend authorization remains authoritative; this does not establish historical unauthorized activity.

## Verification

`test/qa-booking-checkout-context.test.js` compiles and executes the actual modal, selection key and parent binding with synthetic sessions/controlled transports. Nineteen checks cover wrong session ownership; rapid Pay and post-redirect lock; queued Pay after Close; close/unmount during lookup/refresh/API/final owner check; wrong refreshed owner/token; normal one-time session refresh; hidden switch before redirect; A/B/A and listing/hours/spot/day/time/vehicle/event/detail replacement; immutable payload and integer-cent totals; auth/network/HTTP/JSON/link errors and explicit retry; disabled vehicle controls; unchanged-profile rerender; Book Now omission of scheduled fields; unsigned/missing vehicle/invalid listing/demo behavior; StrictMode replay; and actual dialog key.

Five primary checks fail against prior actual source 67702cd4caa6c3c4a580cb9b0614471d2516865d: wrong-owner checkout POST, duplicate pending POST, queued Pay after Close, POST after closing during lookup, and redirect after hidden account switch. Existing cross-tab and vehicle tests pass, with the vehicle source-projection check adjusted to include its new pending/lifetime guard.

Require full tests/build, native CI and disposable PostgreSQL 17 full-schema rehearsal before release. No dependency/schema/migration/backend/API contract change. Mutation tests use only synthetic/disposable fixtures. Release verification performs no live login/session refresh/checkout/hold/charge/refund, authenticated booking/profile/listing/Storage write, message/email or database migration/write. Public HTTP checks do not prove signed-in Stripe acceptance.

## BetterQA acceptance

1. On desktop/mobile, review a real listing's selected spot and vehicle, then open Stripe TEST checkout normally. Check Book Now and Schedule for Later, local date/time, duration, event, total/fee and primary/guest vehicle. Normal checkout still needs payment plus webhook fulfilment before a booking is confirmed.
2. Rapid Pay clicks must issue one pending POST. Vehicle controls stay locked while pending, remain switchable while idle and unlock after a current error. Verify API failures and expired sessions show an error and permit explicit retry without automatic replay.
3. Close during delayed authentication/refresh: no new checkout POST afterward. Trigger queued old Pay after Close; it must do nothing. Reopen the same or another selection and verify a fresh usable dialog.
4. Sign out/switch accounts across tabs during lookup, API creation and before redirect; include A/B/A. A different session owner must not be used for the old POST or receive its redirect. Change listing/rate/duration/spot/day/time/vehicle/event and verify obsolete work cannot affect the replacement.
5. Delay an already-submitted checkout response, then Close/navigate away or replace the dialog. No late redirect/error may affect the new context. A server session/hold may still exist; inspect the original account's outcome and let existing backend expiry/availability rules handle it. Recheck valid payment, decline, capacity/double-booking and hold behavior with Stripe TEST.

Signed-in browser and Stripe TEST acceptance remain pending for BetterQA. No real checkout/payment or QA authenticated hold was created during automated release verification.

## Release and rollback

Deploy the exact tested commit only to Vercel QA project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app. Check exact-SHA/all-flag readiness, public pages and anonymous initial-checkout/profile/action denials. Compare counts and booking/listing/review/profile/hold fingerprints before/after, preserving concurrent tester activity. Confirm actual production unchanged.

QA rollback redeploys 67702cd4caa6c3c4a580cb9b0614471d2516865d. No database rollback; the previous checkout UI defect returns while prior repairs remain.
