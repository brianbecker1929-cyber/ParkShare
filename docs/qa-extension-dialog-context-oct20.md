# QA follow-up: extension dialog context and email sign-in handoff

Code-identified extension UI correctness/account-context defects; no new BetterQA ticket ID. QA only, stacked on PR #201 and the full prior repair stack. No main merge or actual production promotion.

## Defects and repair

The signed-out Add Additional Time email flow rendered SignInModal with its default closeOnAuth=true. Successful sign-in called the dialog close handler and cleared extendBookingId, losing the intended booking. The extension modal also retained duration/errors across booking/account changes, did not check session ownership, allowed simultaneous pending submissions, and could create checkout after closing during session lookup or redirect from a late response after closing/account changes.

A root request hook now binds intent to its current identity/context. It adjusts its own state on account changes before children commit: only an anonymous email request survives the first sign-in; subsequent account changes/sign-out clear it. Current-context callbacks reject old open/close actions, including A to B to A and a different booking in one account. Booking IDs use the existing strict positive safe-integer validator. The modal is keyed by account and booking, resetting duration/loading/errors. The email sign-in starts on Sign in and uses closeOnAuth=false; explicit cancellation still clears intent. Successful sign-in only opens the selected booking's dialog, never automatically extends or pays. Backend renter ownership remains authoritative for an email opened with the wrong account.

Each dialog lifetime has an active flag and synchronous pending lock. Checkout captures its original account/booking/duration, checks the session owner before POST (including refresh), and ignores disposed callbacks. The root context predicate blocks work even before effect cleanup. Explicit close invalidates immediately. A final session lookup checks for cross-tab identity changes before navigation, including those React has not delivered yet. Successful navigation keeps the pending lock until unmount; errors allow explicit retry. Requests use no-store and are never automatically replayed.

Already-submitted requests may finish server-side and issue a Checkout Session/availability hold after the UI closes. This change does not cancel them, reverse a charge or add server idempotency. Existing hold expiry/availability, renter authorization, canonical times, price and webhook/refund protections are unchanged. Independent global navigation and edit/delete/cancel helper account scoping remain outside this repair. No migration or dependency change.

## Verification

`test/qa-extension-dialog-context.test.js` has 19 checks executing the actual compiled modal, actual root request hook, actual root key/sign-in JSX and actual SignInModal submit handler. Controlled sessions/refreshes/responses/JSON bodies cover close/unmount/context invalidation before POST and after POST, duplicate submits, immutable booking/duration, session mismatch before request and before redirect, error recovery/no replay, malformed/401 responses, valid refresh, invalid IDs, anonymous handoff, sign-out, A/B/A, stale booking callbacks and explicit sign-in cancellation.

Five primary checks fail on prior source 41107bf43e5d10300ccd249668b7f0b0fafbb6bb: checkout after close during lookup, duplicate pending POSTs, redirect from an already-submitted response after close, missing account/booking keys and loss of the email booking on real sign-in submit. All focused checks pass with the repair. Fixtures use synthetic identities, injected POST transports and redirects; no real checkout, payment, hold, email or account is created.

Run full native tests/build and PostgreSQL 17 full-schema rehearsal on the exact release SHA before deployment.

## BetterQA acceptance

1. Signed out, open a valid Add Additional Time email link, then sign in as the intended renter. The same booking's extension dialog should open with +1 hr selected; sign-in must not clear it or automatically start checkout. Explicitly cancelling sign-in must dismiss the request. Wrong-account attempts remain denied by the backend.
2. Open extension for one booking, choose another duration, then close/open a different booking or switch account/sign out (including cross-tab and A to B to A). No old dialog, duration, loading state, error, open/close callback or redirect may survive into the new context.
3. Delay getSession/refresh. Close or change account/booking before releasing it: no new checkout POST from that obsolete attempt. Include context changes before effect cleanup. Repeated Extend & pay clicks while pending should issue one POST for that pending action with its original booking/duration.
4. Delay the POST response/body or final session check. Close/change context before releasing: no obsolete redirect/error. A request already submitted may still complete on the server; do not assume closing cancels the Checkout Session/hold or reverses a payment. No automatic retry.
5. In Stripe test mode, verify normal same-account extension checkout, session refresh, unavailable interval errors and explicit retry. Confirm original billing/ownership/hold/canonical-time protections and truthful return notices. Test malformed IDs and old cancellation URLs; no accidental extension dialog/checkout should open.

Signed-in browser/Stripe acceptance remains with BetterQA; synthetic tests do not certify live charging or fulfilment.

## Release and rollback

Deploy exact tested commit only to QA project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app . Require exact-SHA/all-flag readiness, extension deep-link/public pages and existing signed-out checkout/private endpoint denials. Verification performs no authenticated account/payment/refund/hold, booking/listing/Storage or message/email writes; no migrations/backfill. Compare read-only before/after counts and booking/listing fingerprints, retaining any concurrent tester changes. Confirm actual production unchanged. Final evidence goes in the PR body.

QA rollback redeploys 41107bf43e5d10300ccd249668b7f0b0fafbb6bb. It retains prior backend protections and truthful return notices but restores these dialog defects.
