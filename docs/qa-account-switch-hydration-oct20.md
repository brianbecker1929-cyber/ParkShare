# Account-switch profile hydration — 20 October 2026

## Confirmed defect and repair

Code-identified defect; no assigned BetterQA issue number. On a different account's SIGNED_IN event, the global auth synchronizer kept the previous displayed user until the deferred session/profile read completed. Private views could therefore continue showing old account state while the browser's SDK session already belonged to another account. The synchronizer checked session ownership only before the profile request, accepted any non-null profile, and built the displayed user with the earlier session's metadata. A storage change during profile loading could publish stale identity or stale vehicle/contact details. A missing/unsupported profile role could reach buildAppUser's editable metadata fallback.

Track the account from supported auth events. On a different account, synchronously request clearing the displayed app user before any deferred SDK work. Retain the current view during normal same-account token refresh/repeated SIGNED_IN events. Recovery/sign-out/missing sessions retain their existing identity-clear behavior; malformed/blank event user IDs cannot schedule hydration or open recovery.

Require the bounded id/name/role profile to match the event/session account and contain exactly driver or host. After the profile read, take a second current-session snapshot and recheck generation/lifetime and account ownership before publishing. Build with that latest same-account user metadata. Invalid/missing/foreign profile or role fails closed with the existing profile-unavailable callback; session mismatch/error fails closed. Catch SDK/profile failures and let a later explicit auth event retry. No automatic retries, extra profile columns, metadata-role authorization, or Supabase reads inside the auth callback are added.

Scope: displayed account/profile consistency. These getSession snapshots read browser session state and are not server identity verification, session revocation or an atomic cross-tab authorization boundary. The application clears on receipt of an account-change event and React applies the state update at its next commit; this does not promise hiding data before an event arrives. Same-account sessions/token rotation are allowed. Existing backend Auth/RLS/role controls remain authoritative. Already-sent SDK/HTTP operations are not cancelled by this change.

No endpoint/admin privilege, schema/grant, credential, dependency, payment, email-template or deployment-target change. The extra successful hydration read is a getSession snapshot after the existing profile read. API shapes checked against https://supabase.com/docs/reference/javascript/auth-getsession and https://supabase.com/docs/reference/javascript/auth-onauthstatechange .

## Verification

`test/qa-account-switch-hydration.test.js` runs the actual synchronizer and actual App buildAppUser with synthetic sessions/profiles and controlled deferred reads. All 18 new checks pass. The previous actual synchronizer fails 11 while seven preservation checks pass. Existing cross-tab/recovery tests are adjusted only for the intentional synchronous account-clear notification.

Coverage: all four supported hydration events; no SDK reads in the auth callback; A→B immediate clear; same-account refresh and repeated sign-in preservation; A→B→A stale generations; storage changing without an intervening event during profile read; matching server roles overriding editable metadata; malformed/foreign/missing profiles and roles; latest vehicle/contact/email values; failed initial/final session reads; profile errors; auth change/sign-out/recovery/disposal during the final read; malformed event IDs; unsupported events; later explicit retry. No real accounts, sessions, passwords, emails, database rows or payments are changed by these checks.

Run full local tests/build/diff checks, native CI and the captured PostgreSQL schema rehearsal on the exact candidate tree before QA-only deployment. Verify the stable QA alias, deployed SHA/readiness flags, served JS and public/access HTTP checks. Record final counts/deployment evidence in the PR. Real two-tab browser/provider acceptance remains for BetterQA; automated fixtures do not log in to actual accounts.

## BetterQA acceptance

1. Use approved Driver and Host QA accounts. Sign in as account A, then switch to B in another tab. With B's profile response delayed, A's account content must be cleared once the auth-change event reaches the original tab. Only B's valid owning profile should restore its account UI.
2. Switch A→B→A with delayed replies. No obsolete profile should replace the latest account. Repeat sign-out and recovery during loading; old replies must not restore account views.
3. Delay a profile response and change/clear the SDK session before it returns. The old account must not be published. Missing/foreign/invalid-role profiles and session errors should leave account content unavailable; a later valid sign-in should recover.
4. Verify same-account token refresh and tab refocus do not temporarily clear account views or interrupt an unchanged account. Confirm both Driver and Host roles and existing private-view access behavior.
5. Save Driver vehicle/contact details, then refresh/rehydrate while another profile read is pending. Confirm current same-account metadata is used. Retest ordinary sign-in/signup, recovery, booking/message/extension account isolation and explicit retry after a temporary provider failure.
