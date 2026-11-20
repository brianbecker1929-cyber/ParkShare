# QA follow-up: confirmed review submission and account isolation

Code-identified review form defects; no assigned BetterQA bug ID. QA only, stacked on PR #206 and all preceding fixes. No main merge or actual production promotion.

## Defect and repair

The booking Review dialog called its success callback without saving when its user prop was absent. Both real review forms accepted a session returned for a different account, allowed rapid duplicate submits before React rendered, and left rejected authentication/network promises uncaught. Close/unmount/account/listing changes did not invalidate delayed actions or responses. A public review response for a previous listing could replace the currently viewed listing's reviews.

Both forms now use one shared submission hook. Each draft belongs to its original account, listing and booking/form lifetime. Identity/target changes reset its draft and state before children commit; Close/Cancel and unmount invalidate callbacks immediately. Session lookup must return the original account before POST. A synchronous pending lock prevents duplicate submissions; draft and target are captured before waiting. A success requires a matching API review row (ID, listing and rating), rather than only an HTTP success. Current failures remain visible in role=alert feedback, unlock explicit retry and never mark a booking reviewed. No automatic replay occurs. The forms enforce the existing 1–5 rating and 2–1500 character rules and disable draft edits while pending. Explicit demo reviews remain local.

The booking dialog is keyed by account and booking. React StrictMode setup/cleanup replay creates a fresh token while keeping old callbacks invalid. Public reviews are stored with their listing identity; previous fetches are aborted and their ignored-abort responses cannot replace the current feed. Successful real submission refreshes only its current public feed.

Server authentication, paid-session eligibility, Host self-review denial, duplicate protection, timestamps and public review projection remain authoritative and unchanged. A review POST already sent may still save after closing, navigating or signing out. This does not recall that request, revoke tokens atomically or remove existing reviews. Refresh the original listing's reviews before retrying an unknown outcome. Guards follow observed app identity plus the returned browser session; they do not prove a historical unauthorized write happened.

## Validation

`test/qa-review-submission-context.test.js` compiles and runs the actual components and shared hook with synthetic sessions and controlled transports. Its 23 checks cover signed-out false success; mismatched session owner; rapid submits; auth/network/HTTP/JSON failures and explicit retry; close during lookup and queued callbacks; A/B/A identity changes; late errors/results after close/unmount; malformed success; target replacement; old public read response; successful refresh; local demos; actual dialog key; and StrictMode lifecycle replay.

Five primary checks fail against previous actual source 1c0eaddd43178684143373a09736dac9572d53b1: signed-out success, wrong session owner, duplicate submit, uncaught auth failure and stale public review response. Existing server review tests remain in the suite. The source-projection test now expects both forms to call the single shared API transport.

No live login, review, booking, payment, refund, hold, listing, Storage, email/message or QA database write/migration is used for release verification. No dependency or schema change. Native CI and the existing disposable PostgreSQL 17 full-schema rehearsal must pass before QA release. Record exact-SHA checks/deployment in the PR description.

## BetterQA acceptance

1. As a Driver with a completed paid booking, submit through My Bookings. Confirm the dialog closes after saved success, the booking shows Reviewed, and the listing's public review survives refresh. Repeat through the listing review form using another eligible test Driver/listing pair.
2. Verify signed-out/expired/different-account submission never shows success. Sign out or switch A/B/A in another tab while a form is open and during delayed session lookup. Old text/actions must not be submitted for the new account.
3. Rapid Submit clicks issue one pending POST. Simulate auth, network, 403 eligibility, 409 duplicate, 503 and malformed-response failures: show an inline error, no false Reviewed state, and allow explicit retry when complete. Refresh reviews before retrying if a POST's response was lost.
4. Close/Cancel while lookup is delayed: no subsequent POST. Close or navigate after an already-sent POST: it may save, but late success/error cannot close a different dialog, mark another booking reviewed or alter a new draft. Reopen the same or another booking and check fresh draft/rating.
5. Browse between two listings while delaying the first public review response; only the selected listing's reviews may appear. Check mobile/desktop, normal success refresh, empty and oversized input, rating and local demos. Existing self-review, unpaid/future booking and duplicate review denial must remain intact.

Signed-in browser and actual review submission acceptance remain pending for BetterQA. Synthetic tests and public HTTP checks do not close their acceptance work.

## Release and rollback

Deploy only the exact tested commit to QA Vercel project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app. Verify exact-SHA/all-flag readiness, public review feed, public/booking pages and anonymous private-action denials. Compare before/after counts plus booking/listing/review digests, preserving concurrent tester activity. Confirm actual production unchanged.

QA rollback redeploys 1c0eaddd43178684143373a09736dac9572d53b1. No database rollback is needed; it restores the previous review form defects.
