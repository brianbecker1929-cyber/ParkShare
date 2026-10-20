# Password recovery dialog handoff — 20 October 2026

## Confirmed defect and repair

Code-identified defect; no assigned BetterQA issue number. App changed the primary dialog's initialScreen prop on PASSWORD_RECOVERY, but SignInModal initializes its screen once per mount. An already-open dialog therefore kept its previous screen. A repeated recovery event also retained typed passwords and pending handlers. Independent message/extension email sign-in overlays could cover recovery. The global auth synchronizer neither retired prior profile reads nor cleared the previous displayed identity on a valid recovery event.

Increment a recovery revision for each valid recovery callback and key the primary dialog with it. React replaces the mounted dialog, runs its existing request cleanup and initializes a fresh password form with empty secrets. Give the primary auth dialog precedence over message-link sign-in and extension overlays. Preserve anonymous email booking selections and existing closeOnAuth=false callbacks; closing recovery restores the booking sign-in flow. Closing the primary dialog resets its next initial screen to landing.

Treat PASSWORD_RECOVERY as an auth generation boundary: synchronously retire queued/in-flight profile hydration, clear the displayed app user, and open recovery only with a session user ID. No Supabase reads run inside the auth callback. Later normal auth events, including USER_UPDATED after password update, retain existing deferred session/profile hydration. Existing extension account-change rules still clear an already-authenticated account's extension selection when its displayed identity is cleared; anonymous email selections survive their first sign-in.

Scope is event-to-dialog handoff and stale profile invalidation. The existing password update validation/12-character policy and request ownership remain unchanged. This does not cancel an already-submitted Auth request, revoke sessions, change provider configuration, implement recovery account binding across later account switches, or create an atomic authorization boundary. An SDK request already sent can complete and emit global events after its dialog is replaced. Dialog cleanup takes effect at React replacement/unmount; profile generation invalidation occurs synchronously in the event callback. Existing Auth/RLS remain authoritative.

No endpoint, admin privilege, schema, grant, credential, dependency, payment or email template change. Current event API checked against https://supabase.com/docs/reference/javascript/auth-onauthstatechange .

## Verification

`test/qa-recovery-dialog-handoff.test.js` exercises the real auth synchronizer and compiles the actual App auth state/subscription/overlay JSX and SignInModal. A controlled hook renderer applies React's type/key mount rule and runs actual effect cleanup. All 15 checks pass; the previous actual source fails 12 while three preservation checks pass. Existing cross-tab and extension tests are adjusted for the intentional recovery identity clear and overlay guard.

Coverage: already-open sign-in, repeated recovery links and cleared secrets, one visible auth dialog over message/extension email flows, anonymous booking context and explicit cancellation, primary dialog Close/reopen, stale queued and in-flight profile success/error, same/different recovery account, missing session, normal USER_UPDATED hydration, unsubscribe, and late success/error/cached password handlers after replacement. Tests use synthetic SDK/session/profile/password data only.

Run full local tests/build/diff checks, native CI and the captured PostgreSQL schema rehearsal on the exact candidate tree. Deploy only parkshare-qa, then verify the stable alias, deployed SHA, readiness flags, served bundle and public/access HTTP checks. Record counts and deployment evidence in the PR. Real browser/provider/mail/recovery acceptance remains for BetterQA; automated checks do not consume recovery links or update actual passwords.

## BetterQA acceptance

1. Open an approved QA account's valid recovery link with sign-in or signup already open. Expect one fresh password editor, with both password fields empty.
2. Enter draft passwords, then open another valid recovery link. Expect a fresh empty editor. Delay an earlier update response; its late success/error must not change the replacement form. An update already sent to Auth may still finish remotely.
3. Repeat recovery while signed out on message and Add Additional Time email links. Recovery must appear above the booking flow with no competing sign-in dialog. Close recovery; expect the original booking sign-in flow and its explicit Cancel behavior.
4. Delay a profile read from a previous login and deliver recovery for the same or a different QA account. No late result should restore the previous displayed identity or replace recovery with a stale profile warning.
5. Complete recovery using matching passwords of at least 12 characters; verify success, normal subsequent sign-in and existing account/profile behavior. Check errors, explicit retry, repeated submit, Close/unmount, and ordinary sign-in/signup/reset/resend regressions.
6. Test expired/invalid/missing-session recovery links and account switches with approved QA accounts. Provider/link handling and recovery ownership across later session changes are unchanged; report those separately if present.
