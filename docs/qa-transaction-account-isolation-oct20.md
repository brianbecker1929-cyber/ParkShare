# QA follow-up: transaction account isolation

Code-identified financial UI privacy/correctness defect; no new BetterQA ticket ID assigned. QA only, stacked on PR #198 and all prior repairs. No main merge or actual production promotion.

## Defect and repair

The shared Transactions/Host earnings hook checked for a token but not that its session belonged to the account whose screen initiated the load. A delayed lookup or refresh could therefore use account B's session in a screen still associated with A. Loaded spending, earnings, payout rows and errors also survived the first render after an identity change; the full Transactions view was keyed only by role, so switching between accounts with the same role reused its category selection.

The hook now captures a fresh scope for every account interval, including A to B to A. Render-time masking hides any snapshot from a previous interval immediately, including the Host earnings card without remounting its parent. Session lookup and refresh must match the initiating account before any request. A known foreign session is rejected without attempting refresh. Effect cleanup aborts reads; an active/scope check rejects late session, response, body and error callbacks even when transport ignores cancellation or cleanup has not yet run. Requests use no-store. Missing/malformed successful payloads produce an explicit error with empty safe arrays rather than an empty-history claim or a crash.

Transactions keys now include role and account ID, resetting category selection for another account. Updating profile details for the same ID does not refetch transaction history. Signed refund values and the payout-unavailable signal are preserved. Backend identity/ownership checks, calculations and settlement records are unchanged. No migration or dependency change is required.

This repair covers financial data supplied by useTransactions. Independent Host Dashboard listing/booking/photo/payout-connection loaders and their action dialogs are outside this change. It is not evidence of a historical server authorization bypass or confirmed disclosure.

## Verification

`test/qa-transaction-account-isolation.test.js` executes the actual hook with controlled effects and transports, and compiles the actual Transactions JSX keys. Eighteen checks cover first-render isolation, sign-out, foreign initial/refreshed sessions, successful same-account refresh, lookup/refresh failures, stale work before cleanup and after disposal, late successes/errors/JSON bodies, A/B/A, same-account profile refresh, malformed payloads, HTTP/JSON errors, signed refunds/payout unavailability, signed-out behaviour and account-based category resets. Transports and financial rows are synthetic fixtures; no real accounts are signed in or records changed.

Four primary regression checks fail against prior commit 54f900a95b259266a41c69ab2470379d17f44374: old rows remain in the first changed-account render, a foreign session can start the request, refresh can use the wrong account, and same-role React keys are identical. All targeted checks pass with the repair. Run full native CI/build and PostgreSQL 17 full-schema rehearsal on the exact release commit before QA deployment.

## BetterQA acceptance

1. Using authorized disposable accounts with different histories, open Transactions, select an earnings/payout category, then switch to another same-role account (including from another tab). Old rows, addresses, totals, payout-unavailable notices and errors must disappear immediately. The new account starts on its own default category and sees only its history.
2. Delay session lookups, transaction responses and JSON bodies; change account or sign out before releasing them. Old work must not populate the new screen or initiate a new request using another account's token. Include A to B to A and navigation away while a request is pending.
3. Check the Host earnings card across account changes: spending/earnings/payout values supplied by the transaction hook must be empty/loading until the current account loads. This does not certify the dashboard's independent listing/booking/Connect loaders.
4. Confirm ordinary same-account loads and token refresh, partial/full refunds (including retained negative fees), payout-unavailable messaging, empty histories, Driver category access and existing Host route guards.
5. Simulate an expired or mismatched session and failed/malformed transaction response. Show a clear error with no old rows; never treat a failed load as a confirmed empty history.

Signed-in browser acceptance and real financial history checks remain BetterQA's responsibility. Automated fixtures do not certify hosted Stripe payout delivery.

## QA release and rollback

Deploy the exact native-tested commit to QA project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app . Require exact-SHA readiness, public pages and anonymous transaction/account/message denials. Compare QA booking/listing/extension/refund/message/Storage aggregate counts and full booking/listing digests before and after; confirm actual production unchanged.

Verification performs no account login/creation, real message/email, payment/refund, booking, listing or Storage write. No migration/backfill or historical reinterpretation. Rollback is a QA redeployment of 54f900a95b259266a41c69ab2470379d17f44374; it preserves all database protections but reintroduces this financial UI defect. Deployment/CI evidence belongs in the PR description.
