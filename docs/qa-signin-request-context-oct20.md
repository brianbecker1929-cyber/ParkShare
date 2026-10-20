# QA follow-up: sign-in failures and obsolete modal results

Code-identified sign-in defect; no assigned BetterQA bug ID. QA only, stacked on PR #209 and all prior fixes. No merge into main or actual production promotion.

## Defect and repair

The password sign-in handler did not catch rejected SDK or profile promises and cleared loading before its profile read finished. A network error could leave the form stuck or reject without inline feedback. A second sign-in could start while the first profile lookup remained pending. Closing or changing auth screens did not invalidate pending sign-in callbacks; a stale profile could later invoke onAuth or close another context. Stored session ownership was not rechecked around the profile lookup.

Each password sign-in now captures its credentials and a modal/screen/attempt lifetime, locks synchronously through authentication, profile loading and session verification, and catches current failures with inline feedback and explicit retry. Credentials and recovery action are disabled while pending, with an input-handler guard. The auth response must identify a matching session/user. The existing bounded id/name/role profile query must return the original account with a supported Driver/Host role; stored session ownership is checked before the read and again before publication. A malformed or changed session/profile never invokes the modal's onAuth callback.

Close and auth-screen navigation invalidate old attempts immediately and clear credentials. Unmount and StrictMode cleanup invalidate pending work; replay unlocks a usable form. Old queued Submit actions or late success/errors cannot update, authenticate or dismiss the replacement modal context. Successful closeOnAuth=false still preserves the extension-email sign-in handoff. Existing unconfirmed-email guidance and signup consent/duplicate handling remain intact.

Scope is the modal's password sign-in flow and its screen/dismissal guards. A signInWithPassword operation already submitted can still establish a Supabase session and emit SDK/global auth events after closing. This does not cancel/undo that operation, force sign-out, atomically revoke tokens or change SDK/global synchronizer internals. Session checks use the latest observed browser session, not an atomic guarantee against every cross-tab race. Signup, resend and password-recovery request internals are outside this repair; no real accounts, passwords or sessions are modified during verification.

## Verification

`test/qa-signin-request-context.test.js` compiles and executes the actual modal with isolated hooks, synthetic sessions and controlled auth/profile transports. The JSX submit wrapper returns the actual handler Promise solely to await its existing logic deterministically. Seventeen checks cover rejected auth/profile requests and retry; duplicate submits through the profile read; Close and queued callbacks; disposal during authentication/profile/session checks; screen changes and signin/signup/signin; changed/missing sessions; malformed auth and mismatched/missing-role profiles; unconfirmed-email guidance; captured/locked credentials; Driver/Host success and bounded profile query; closeOnAuth=false; invalid input; late failures; and StrictMode replay.

Five primary checks fail against previous actual source 20f781d1c64c7e8f473342caf59de8d070838cc9: auth rejection, duplicate submit during profile loading, profile rejection, stale callback after Close, and changed-session publication. Existing signup rendering fixtures now supply stable useRef and unused effect hooks. The existing isolated extension-email sign-in fixture supplies matching synthetic auth/session data and session reads, preserving its explicit intent assertion.

Require full tests/build, native CI and the existing disposable PostgreSQL 17 full-schema rehearsal before QA deployment. No dependency, backend, grant, schema or migration change. Mutation tests are synthetic/disposable; no live login, signup, password reset/update, resend/email, auth refresh, payment/hold/refund, authenticated profile/booking/listing/Storage write or database migration/write is used in release verification. Public HTTP checks do not prove real sign-in acceptance.

## BetterQA acceptance

1. Sign in normally as a Driver and Host. Check landing/private-page/booking routes and sign-in from an extension email. The extension's chosen booking must remain selected when sign-in succeeds; explicit cancellation must still clear it.
2. Delay the profile lookup after successful auth. Loading and credential inputs must remain locked; rapid Enter/Submit clicks produce one pending sign-in sequence. On current auth/profile/session/network failures, show an inline error, unlock and allow explicit retry without automatically replaying credentials.
3. Close or switch to signup while authentication/profile/session lookup is delayed. Old responses must not call the modal handoff, dismiss a new context or show stale errors. Repeat signin/signup/signin and queued old Submit/Close actions. A request already sent may still authenticate at SDK level; inspect actual account/session state rather than treating Close as sign-out.
4. Sign out or switch accounts in another tab during profile loading. A missing/different session must prevent the old modal from publishing its profile. Check malformed/mismatched profile handling and existing unconfirmed-email/resend guidance.
5. Recheck invalid credentials, desktop/mobile inputs, signup dismissal/consent, existing-account recovery and password recovery screens for regression. No password or recovery request behavior is intentionally changed.

Signed-in browser, real SDK event timing, email and recovery acceptance remain pending for BetterQA.

## Release and rollback

Deploy the exact tested commit only to QA Vercel project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app. Verify exact-SHA/all-flag readiness, public/auth route rendering responses and anonymous private/action denials. Compare counts and booking/listing/review/profile fingerprints before/after; preserve concurrent tester changes. Confirm actual production unchanged.

QA rollback redeploys 20f781d1c64c7e8f473342caf59de8d070838cc9; no database rollback is needed. It restores the sign-in UI defect while preserving prior fixes.
