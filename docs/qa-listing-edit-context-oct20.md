# QA follow-up: confirmed Host listing saves and editor isolation

Code-identified Host editor correctness defect; no assigned BetterQA bug ID. QA only, stacked on PR #205 and all preceding repairs. No main merge or actual production promotion.

## Defect and repair

The Host save handler treated a Supabase update with no error as success, without requesting a returned row. A zero-row update could therefore close the editor and show client-only changes on its card even though no listing changed in the database. The save lacked a synchronous duplicate lock and account/editor lifetime checks. Closing/replacing an editor did not invalidate old Save/Close callbacks or late card updates; a rejected save promise was not caught by the modal.

The update now requires the original Host session and current editor intent, filters by original listing ID plus host_id, and requests only id/price/description/features/spots/spaces with maybeSingle. Missing, mismatched or malformed returned rows fail explicitly; a confirmed row supplies canonical saved fields for the matching card. The live QA listing SELECT/UPDATE policies were inspected read-only and retain owning-Host access, role checks and ownership WITH CHECK. No grants, policies or schema change is needed.

Each editor captures a minimal, deep-copied editable listing snapshot and has a distinct request token/revision key, including same-ID replacements. Account changes clear the private editor before children commit; A/B/A cannot revive callbacks. Closing/replacing/unmounting invalidates old requests immediately. The original payload is deep-copied before authentication lookup, so later draft/source mutation cannot redirect or change its pending save. Synchronous locks in the modal and save hook prevent duplicate submissions before React renders. Success closes only the confirmed current editor, updates only the matching card using returned values, and invalidates further Save actions. Current failures remain open with an inline accessible error and unlock explicit retry; no automatic replay occurs. Existing hourly-rate/rentable-spot validation and drawn spot IDs/bounds are preserved.

Closing an editor during save remains possible. Closing/unmounting during auth lookup prevents a new update afterward. Once the update has been submitted, leaving/signing out cannot recall it or roll it back; refresh the original Host's saved listing to confirm its outcome. Guards use observed app identity and the locally returned session, while RLS remains authoritative for server authorization. This is not atomic cross-tab token revocation or optimistic concurrency/version conflict protection between independent legitimate editors. No address/timezone, publication, delete, booking/refund, migration or dependency changes.

## Verification

`test/qa-listing-edit-context.test.js` executes the actual helper/hook with controlled state/effect cleanup and synthetic Supabase session/update builders. It also executes the actual React editor handlers/JSX and Host binding/key/props. Twenty-one checks cover zero-row false success; session owner mismatch; duplicate submissions; queued Save after Close; unmount/lookup/response/account/A-B-A races; same/different-ID replacement; bounded ownership-filtered update and canonical row values; malformed/error replies; explicit retry; immutable snapshots/payload; invalid price/ID/signed-out intent; profile rerender; modal synchronous lock, geometry, rejected-promise inline error, stale success/error, and original rate/rentable validation. The independent Host rendering fixture supplies an empty edit hook.

Five checks fail against actual previous source 09660f10b0b6d40e1277e0348ecc07aa7ac926a9: zero-row success, wrong session owner, duplicate save, queued Save after Close and late card update after disposal. All focused checks pass with the repair. The old actual dashboard handler is executed for reproduction; no alternate implementation replaces its logic. No live Host listing is edited in automated verification.

Require full tests/build and native PostgreSQL 17 full-schema rehearsal before QA release. Record final counts, exact-SHA CI/deploy and data comparison in the PR body.

## BetterQA acceptance

1. Open Edit on an owned listing, change price/description/features/rentable spots and Save. Confirm the current editor closes only on a confirmed saved row, the matching card shows server-saved values and a refresh retains them. Verify original drawn spot IDs/bounds and normal geometry remain intact.
2. Simulate a deleted/unavailable listing, denied update, expired session, zero-row response or network failure. The editor must remain open with an inline error and permit explicit retry after completion; it must not show an unsaved card as successfully changed. If the response was lost after submission, refresh to confirm the actual outcome before retrying.
3. Rapid Save clicks must issue one pending update. Close then reopen the editor (same and different listing), and trigger queued old Save/Close actions: they must not update the old listing or close the new editor. Reopened drafts must start from that listing's saved state.
4. Sign out/switch accounts in another tab while editing or while authentication lookup is delayed, including A to B to A. The editor must disappear when the app detects the identity change; a different session owner must not start the pending update. Leaving/closing during lookup must prevent a new update afterward.
5. Delay an already-submitted update response, then close/replace the editor or leave the dashboard. Late success/error/finally callbacks must not change another editor/account or show stale errors. A submitted database update may still complete; refresh the original listing to check. Verify desktop/mobile saving and idle dismissal, same-account profile refresh, price validation and at least one rentable spot.

Signed-in browser and real database edit acceptance remain pending for BetterQA. Synthetic checks do not demonstrate any historical unauthorized write occurred.

## Release and rollback

Deploy only the exact tested commit to QA project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app. Verify exact-SHA/all-flag readiness, public/Host pages and anonymous private-data/action denials. Release checks perform no live authenticated edit, login, deletion, booking/payment/refund/hold, QA database migration/write, Storage or message/email operation. Compare safe counts and booking/listing fingerprints before/after; preserve concurrent tester activity. Confirm actual production unchanged.

QA rollback redeploys 09660f10b0b6d40e1277e0348ecc07aa7ac926a9. It preserves prior deletion/cancellation/backend safeguards but restores this editor defect.
