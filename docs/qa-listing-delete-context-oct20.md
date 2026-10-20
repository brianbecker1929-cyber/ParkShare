# QA follow-up: Host listing deletion account/request isolation

Code-identified Host delete UI correctness defect; no assigned BetterQA bug ID. QA only, stacked on PR #204 and all preceding repairs. No main merge or actual production promotion.

## Defect and repair

The Host deletion helper accepted a hostId but never compared it with the session returned by its asynchronous lookup. An old confirmation could therefore issue a new deletion request with a different account's token after an account switch. The existing server still enforces Host role and listing ownership; this is obsolete UI intent reuse, not a server authorization bypass. The dashboard's state-only pending check also allowed duplicate submissions before React rendered. Keep, replacement confirmations and unmount did not invalidate callbacks; late failures/cleanup warnings could alert after navigation, and old finally handlers could clear a newer confirmation.

A dedicated Host deletion hook now binds each confirmation to the original account and immutable raw/display listing IDs. It does not retain addresses, photographs or the entire mutable listing. Identity changes clear the confirmation before children commit; A/B/A does not revive old callbacks. Keep and replacement confirmations eagerly invalidate old Delete/Keep callbacks, including same-ID replacement. Unmount invalidates the request token.

Delete locks synchronously before its first await, blocking duplicate clicks. While pending, Keep is disabled and replacement/close actions are ignored until the result is known. The helper requires an explicit current-context guard, fails closed without one, checks current request lifetime after lookup and immediately before POST, and requires session.user.id to match the captured Host. It retains the existing no-refresh authentication behavior. Late bodies/errors/finally actions cannot remove current cards, show alerts or close another confirmation. Current success removes only the captured display ID and still reports queued photo cleanup. Blocked deletion preserves its card and server error; retry requires a fresh confirmation. Lost responses preserve the existing honest unknown-outcome message and have no automatic replay.

The API's Host ownership and FK protections for bookings/holds, durable photo cleanup and Storage policy are unchanged. Once a deletion POST is sent, leaving/signing out cannot recall it or roll back database/Storage cleanup. Refresh saved listings to verify that outcome. These guards use the app's observed identity and locally returned session; they do not provide atomic cross-tab revocation or new server-side authorization. Listing edit/save and upload cleanup before a publication receipt remain outside scope. No migration or dependency change.

## Verification

`test/qa-listing-delete-context.test.js` executes the actual helper/hook with controlled state/effect cleanup and synthetic session/HTTP responses, plus the actual Host hook binding, card filtering and Delete/Keep JSX props. Nineteen checks cover owner mismatch, unmount/session/response/body races, pre-render duplicate clicks, late alerts, Keep invalidation, replacement including same-ID, A/B/A, account change during lookup, pending locks, normal success/cleanup warning, blocked deletion/fresh retry, lost response, invalid/signed-out/missing-guard intent, minimal immutable IDs and profile rerender. Existing helper fixtures now supply session ownership and a lifetime guard; the independent dashboard rendering fixture supplies an empty deletion hook.

Five checks fail against actual previous source b7d37f7f0bda56eac1646d54de3fc310c5fa12cf: different session account, unmount during lookup, duplicate Delete clicks, late error affecting the next account, and queued Delete after Keep. All focused checks pass with the repair. No actual login, listing deletion, Storage cleanup or database write occurs in these tests.

Require full tests/build and native PostgreSQL 17 full-schema rehearsal on the exact source before QA release. Record final CI and deployment evidence in the PR body.

## BetterQA acceptance

1. Open Delete confirmation for an owned listing in Host Dashboard. Switch/sign out in another tab, including A to B to A, before confirming or while session lookup is delayed. Confirmation must clear when the app detects the identity change; old actions must not start a request with the new account's session.
2. Choose Keep, open another confirmation (including reopening the same listing), and trigger queued old Delete/Keep callbacks. They must not delete the old listing or close the new confirmation. Repeat on desktop/mobile.
3. Rapid Delete clicks must submit one pending request. During a pending delete, Keep is disabled and a replacement confirmation cannot displace it. Leaving the dashboard during lookup prevents any new POST afterward.
4. After a POST is already sent, leave/switch accounts and delay success/failure/body delivery. Old results must not show alerts or change the next dashboard. A server deletion/cleanup already submitted may still complete; refresh the original Host's listings to confirm its saved outcome.
5. With disposable authorized QA listings, confirm normal deletion and photo cleanup/queued warning. A listing protected by paid bookings or checkout holds must remain present with the server error and reservation records preserved. Expired/wrong-account sessions must submit nothing. After a lost response, refresh before explicitly reopening a confirmation; no automatic replay is expected.

Signed-in browser and real deletion/Storage acceptance remain pending for BetterQA. Automated callback checks do not demonstrate any historical unauthorized deletion occurred.

## Release and rollback

Deploy only the exact tested commit to QA project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app. Verify exact-SHA/all-flag readiness, public pages and anonymous delete/private-data denials. Release checks perform no authenticated listing deletion, login, booking/payment/refund/hold, database migration/write, Storage operation or message/email action. Compare safe counts and booking/listing fingerprints before/after; preserve concurrent tester activity. Confirm actual production unchanged.

QA rollback redeploys b7d37f7f0bda56eac1646d54de3fc310c5fa12cf. It preserves previous cancellation/backend repairs but restores these Host deletion UI defects.
