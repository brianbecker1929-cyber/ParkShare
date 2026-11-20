# QA follow-up: Driver and Host cancellation account/request isolation

Code-identified cancellation UI correctness defect; no new BetterQA ticket ID. QA only, stacked on PR #203 and all previous repairs. No main merge or actual production promotion.

## Defect and repair

Both dashboards started cancellation from a selected booking, then used whichever session getSession/refreshSession returned. Neither checked that the session belonged to the account that opened the confirmation. A delayed lookup after an account change could start a new POST using the next account's token. The API still authorizes the actual caller; this is unintended UI intent reuse, not a bypass of server authorization. The old handlers also allowed two confirmations before React rendered, and late success/error/finally callbacks could update a disposed or replacement dialog.

A shared cancellation hook now captures the original account and an immutable minimal booking snapshot (raw ID, Driver name and listing title). Each dialog has a distinct request token and revision key, including same-ID replacements. Sign-out/account changes clear the target, notice and error before children commit; A/B/A does not restore old callbacks. Unmount invalidates the token. Closing an idle confirmation or opening a replacement eagerly invalidates old callbacks before the next render.

Confirmation locks synchronously before the first await. While pending, a second confirmation, close or target replacement does nothing; existing busy/dismissal behavior is preserved. The request helper requires the expected account and current request guard, checks both initial and refreshed session ownership, and checks the request lifetime after lookup/refresh and before POST. A known different session is rejected without refreshing it. Late response bodies, errors and finally handlers do not update another request or disposed dashboard. Failure unlocks an explicit retry; there is no automatic replay. Current-account success updates only the captured booking, keeping existing Cancelled versus Cancellation pending status and server message behavior.

The server remains responsible for cancellation eligibility, authorization, refund processing and idempotency. Once a POST has been sent, leaving the page cannot roll back or recall the cancellation/refund; the current UI ignores its obsolete response and the account's saved bookings/transactions should be refreshed to confirm the outcome. The repair uses the app's observed identity and the locally returned session; it does not provide atomic cross-tab session revocation or server-side revalidation of UI intent. No backend, policy, schema, dependency, refund-rule or listing edit/delete change.

## Verification

`test/qa-cancellation-context-isolation.test.js` executes the actual request helper and shared hook with controlled hooks/effect cleanup and synthetic session/network replies. It also executes the actual Host/Driver hook bindings, booking state updates and modal key/props. Nineteen checks cover initial/refreshed owner mismatch, unmount during lookup/refresh/POST/body reading, immediate A/B/A clearing, late errors, pre-render double clicks, queued confirmation after dismissal, replacement including the same booking ID, pending locks, current Driver/Host success, same-owner refresh, explicit failure retry, invalid/signed-out intent, minimal immutable snapshot and profile rerender. The pre-existing Host and Driver empty-state rendering tests inject the shared hook's empty state so its independent read/loading/payout tests remain isolated.

Five checks fail against the actual previous source 1da16851723eebb204ce2218748316df95714925: initial owner mismatch, refreshed owner mismatch, unmount during lookup, duplicate submission and late error after an account switch. All focused checks pass with the repair. All authentication, HTTP and booking updates in these checks are mocked; no actual account, payment, refund or cancellation is performed.

Require full tests/build and native PostgreSQL 17 full-schema rehearsal before deployment. Capture final counts and exact-SHA evidence in the PR body.

## BetterQA acceptance

1. For both Driver My Bookings and Host Dashboard, use an authorized QA booking eligible for cancellation. Open the confirmation and switch/sign out in another tab before confirming or while session lookup is delayed. Include A to B to A. Old confirmation actions must not start a new cancellation using the next account's session; private title/error/notice must disappear when the app detects the account change.
2. Close an idle confirmation, select another booking (and reopen the same ID), then trigger a queued old close/confirmation. It must neither dismiss the new dialog nor cancel the old booking. Rapid Confirm clicks must submit only one pending POST.
3. Delay lookup, refresh or response and leave the dashboard. Before submission, no new POST may start afterward. After submission, check saved booking/refund status on return: processing may have completed even though the old UI response was ignored. An already-sent request is not undone by sign-out or navigation.
4. Pending confirmation remains busy and blocks close/replacement. Current-account failures display the current error and permit an explicit retry after it finishes. A same-account profile/session refresh preserves the current confirmation.
5. Verify normal Driver and Host cancellation eligibility, server messages, original booking ID, Cancelled/Cancellation pending display, and refund record/amount. Existing server eligibility and Stripe idempotency must remain intact. Verify desktop/mobile buttons and keyboard/modal dismissal when idle.

Signed-in browser/Stripe acceptance remains pending for BetterQA. Automated callback checks do not claim a historical real cancellation or refund occurred.

## Release and rollback

Deploy only the exact tested commit to QA project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app. Check exact-SHA readiness/all flags, public pages, and signed-out booking/cancellation/private-data denials. Verification uses no authenticated cancellation, booking/payment/refund/hold, login, message/email, listing/Storage or database write/migration. Compare safe read-only before/after counts and booking/listing fingerprints; preserve concurrent tester activity. Confirm actual production unchanged.

QA rollback redeploys 1da16851723eebb204ce2218748316df95714925. It preserves the prior navigation/backend repairs but restores this cancellation UI defect.
