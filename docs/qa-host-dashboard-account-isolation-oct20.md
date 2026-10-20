# QA follow-up: Host Dashboard account isolation

Code-identified Host UI privacy/correctness defects; no new BetterQA ticket ID. QA only, stacked on PR #199 and the prior repair stack. No main merge or actual production promotion.

## Defects and resulting behaviour

Host Dashboard reused state between Host accounts and did not cancel or invalidate its asynchronous owned listing/booking/review/cover and Stripe-status loads. A late response could overwrite another account's cards, Driver name/vehicle details, private address, review or payout readiness. Initial session lookup only checked for a token, so a switched session could also request B's data for A's screen. Load failures were silent and looked like empty histories. Fast private covers could be applied before the booking cards were constructed, then overwritten by their placeholder.

The root Host Dashboard is now keyed by account ID, remounting all cards, menus, editing/cancellation dialogs and payout state on identity changes. Owned-data and Stripe-status effects depend on the stable account ID and explicit retry revision; each verifies the retrieved session owner, uses no-store and AbortController, and ignores obsolete callbacks, including JSON bodies and photo promises that ignore abort. State is reset at load start. Reviews and bookings are initialized before covers begin, preserving fast authorized images on both card types. Failed or malformed loads show explicit errors/retry and unavailable metrics; loading/failure cannot claim a confirmed empty history or disconnected Stripe account.

Payout setup uses a synchronous pending-attempt lock and binds session lookup/refresh to the original Host. Disposal cancels any POST not yet started and suppresses old errors and redirects. Before redirecting, it rechecks the current session even if React has not yet received a cross-tab identity update. No automatic replay is introduced. A POST already submitted may still create an account/link on Stripe after leaving; closing the dashboard cannot undo it, and this repair does not add server idempotency for retries after an uncertain response.

Backend authorization, booking/refund calculations and historical records are unchanged. No migration or dependency change. Existing edit/delete/cancel request helpers are outside this repair; keyed remounting closes their old dialogs, but does not cancel already-started mutations. Independent global navigation/extension overlays remain outside scope. This is not evidence of a historical backend disclosure.

## Verification

`test/qa-host-dashboard-account-isolation.test.js` executes the actual effect/Connect handler prefix with controlled sessions, bodies, covers and effect disposal. It also compiles the actual root React key and renders the actual Host Dashboard markup. Twenty-two scenarios cover delayed success/error/session/body/photo responses, different Hosts sharing synthetic listing/booking IDs, first-load resets, fast covers, malformed/failed/empty loads, stale payout readiness, expired/foreign sessions, duplicate pending Connect clicks, disposal before POST and after POST, final pre-redirect session changes, explicit retry, signed-out no-request behaviour, loading/error/empty UI distinctions and unavailable payout retry UI. All account IDs, data, POSTs and redirects are synthetic transports, not real hosted actions.

Five primary regressions fail against prior source f4b38b0bdcfc0c1b8284b3a5d6d6f6600b36e37f: late owned data, late cover, late payout status, redirect after session change and identical/missing account keys. All focused checks pass with the repair. Run full native CI/build and PostgreSQL 17 full-schema rehearsal on the exact release SHA before deployment.

## BetterQA acceptance

1. Use two authorized Host QA accounts with different listings/bookings/reviews/Stripe status. Open listing/edit/delete/cancellation menus, then replace the account (including cross-tab). The new dashboard must start fresh with no old cards, Driver/plate/address/review details, menus/dialogs or payout status. Include sign-out and A to B to A.
2. Delay owned-data response/JSON body, private covers and payout-status lookup/response. Switch account or navigate away, then release them. Old results/errors must not reappear or overwrite the new account. Confirm covers load on both listing and booking cards, including fast responses.
3. Simulate failed/malformed dashboard and payout-status responses. Show a clear error and Try again, not no-listings/no-bookings/no-reviews or a false disconnected-Stripe state. Retry must preserve the newer successful result and suppress an older in-flight response/cover. Confirm actual empty histories still show normal empty states after success.
4. In Stripe test mode, repeatedly click Connect while pending: only one POST for that pending action. Change account or leave while its session lookup/refresh is pending: no new POST from that attempt. Change account while the POST/body/final session check is pending: no obsolete redirect or error in the new dashboard. Already-submitted work may complete server-side; do not assume it was cancelled or automatically retry uncertain writes.
5. Confirm normal same-account Connect/Finish setup navigation and refresh, existing payouts/transactions/refunds, scheduled upcoming booking times, private photo access and backend Host ownership guards. Live signed-in/Stripe acceptance remains BetterQA's responsibility.

## QA release and rollback

Deploy exact tested commit only to Vercel QA project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app . Require exact-SHA readiness and all flags, public pages, and anonymous denials for Host owned bookings, Connect status/onboarding, transactions, messaging and private photos. Verification never authenticates or starts a real Stripe Connect/account, message/email, booking/payment/refund, listing or Storage write. No migration/backfill.

Read-only before/after aggregates capture bookings/listings/messages/extensions/refunds/Storage counts plus full booking/listing digests. Existing active tester changes must not be reverted. Confirm actual production unchanged. Put final native/deployment evidence in the PR body. QA rollback is redeployment of f4b38b0bdcfc0c1b8284b3a5d6d6f6600b36e37f; it preserves prior financial/backend protections but restores these dashboard defects.
