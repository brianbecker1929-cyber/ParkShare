# QA follow-up: Driver profile save account and request isolation

Code-identified Driver profile save defect; no assigned BetterQA bug ID. QA only, stacked on PR #207 and all preceding fixes. No merge into main or actual production promotion.

## Defect and repair

The Driver profile save handler used any returned session without matching its owner to the Driver who opened the form. A delayed lookup could therefore PATCH the new account with the previous Driver's contact/vehicle draft. Concurrent clicks could start duplicate saves before React rendered. A late PATCH/refresh response after leaving or signing out could call the global setUser callback with the previous user's object. The form remained editable while saving, so its eventual response could replace newly entered edits. Invalid successful API responses were not validated before replacing form/account state.

The profile page is now keyed by account, isolating drafts, errors and vehicle accordions on identity changes. Each save captures its normalized payload, original account and request lifetime, checks session ownership before PATCH, and locks duplicate submissions synchronously. Leaving/unmounting or changing identity invalidates the attempt and its stale callbacks. Current failures unlock explicit retry without replay. Draft controls and add/remove vehicle actions are disabled while saving and their handlers also check the pending lock.

After a confirmed API response, the returned canonical profile must contain the complete expected string/guest-array shape and pass existing profile validation. The session owner is rechecked before refreshing metadata, the refresh result must belong to the original Driver, and the stored session is checked again before publishing the profile. A post-save refresh failure explicitly says that the profile was saved but its current session could not be confirmed. No stale profile is published in that case. The root functional updater accepts only the still-current account and merges only validated profile fields plus recalculated completion, preserving its other current account fields. StrictMode cleanup/setup invalidates pending work and unlocks the form.

The unchanged server API authenticates and updates the caller, checks the database-owned Driver role, and maintains existing profile validation. This UI repair is not a server authorization bypass fix or atomic cross-tab token revocation. A PATCH already submitted may still save for its original authenticated account after navigation/sign-out. The SDK refresh can also complete if already started; the UI checks do not recall it or override the SDK's internal session behavior. Sign in as the original Driver and confirm saved details after an unknown response before retrying. No historical profile records are rewritten.

## Verification

`test/qa-driver-profile-save-context.test.js` compiles and executes the actual profile/vehicle components and persistence helper against synthetic sessions and controlled transports. Eighteen checks cover wrong session owner; rapid saves; disposal during lookup/PATCH/refresh; A/B/A identity changes; hidden account changes before/after metadata refresh; refresh failure; canonical bounded response/completion; malformed success; HTTP field errors and explicit retry; auth/network/JSON errors; immutable guest snapshot and disabled controls; existing name/guest validation; StrictMode replay; and the root key/functional account update.

Five primary checks fail against prior actual source a6d1e5907b626c7eb86f54347359160315b91b2f: wrong-owner PATCH, duplicate save, PATCH after leaving during lookup, stale global update after leaving, and refreshing a different account after the PATCH. No alternate implementation is substituted for the prior handler.

Require full tests/build, native CI and the existing disposable PostgreSQL 17 full-schema rehearsal before release. No dependency, API schema, grant, migration or database structure change. Verification uses no live login/session refresh or authenticated profile edit; all mutation tests are synthetic/disposable. Public HTTP checks do not prove signed-in profile acceptance.

## BetterQA acceptance

1. As a Driver, edit name/phone/primary vehicle and guest vehicles, then Save. Confirm one request, disabled editing while pending, correct completion, retained current account/role, and canonical saved values after refresh/relogin. Incomplete recommended fields may still be saved under existing rules.
2. Switch accounts or sign out in another tab while editing/delaying session lookup; include A/B/A. Old drafts/errors must disappear, a different session owner must not receive the original PATCH, and old Save callbacks must not start new writes.
3. Delay PATCH or metadata refresh and navigate away/sign out. Late success/error must not restore the old account or publish its fields. A sent PATCH may finish for the original account; sign back in to confirm the saved outcome.
4. Change the browser's account while the PATCH is pending, before metadata refresh. Do not refresh a known different account or publish the old profile. If metadata refresh fails after a successful save, show the saved-but-session-unconfirmed message and confirm persisted values on relogin.
5. Rapid Save clicks must produce one pending request. Check rejected/expired sessions, validation/HTTP/network failures and malformed replies: preserve draft and actionable errors, unlock explicit retry, and show no false success. Recheck guest limits, guest validation sections, primary vehicle selection and mobile/desktop controls.

Signed-in browser and actual saved profile acceptance remain pending for BetterQA.

## Release and rollback

Deploy the exact tested commit only to Vercel QA project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app. Check exact-SHA/all-flag readiness, public pages and anonymous profile/action denials. Compare read-only counts and booking/listing/review/profile fingerprints before/after and preserve concurrent tester activity. Confirm actual production unchanged. Do not perform live login, profile/booking/listing/Storage writes, payment/refund/hold actions, email/messages or migrations in release verification.

QA rollback redeploys a6d1e5907b626c7eb86f54347359160315b91b2f; no database rollback is required. It restores the profile save defect while retaining prior repairs.
