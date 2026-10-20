# Signup request ownership and recovery — 20 October 2026

## Confirmed defect and repair

Code-identified defect; no assigned BetterQA issue number. Final signup used React loading state alone to guard requests and released loading before its profile lookup. Repeated handlers could call Auth again, rejected profile reads escaped the handler, and replies after Close/unmount could still read profiles, publish a user or change screens. Back/role navigation retained prior consent and had unguarded queued callbacks.

Use the shared credential attempt ref to lock synchronously from signup through session/profile verification. Capture the validated draft/role/consent before calling Auth. Check modal/screen/attempt ownership after each await; invalidate queued handlers on transitions and Close/cleanup. Disable and guard Back/consent while creation is pending, keeping Close available. Retire signup/role steps immediately through the existing transition helper; preserve only the required draft and reset consent when returning to or choosing a role.

Keep generic verification guidance for unconfirmed/obfuscated duplicate registrations, clear passwords, and never authenticate these outcomes. For authenticated replies, require matching SDK user/session, verify stored session ownership before and after the bounded owning profile read, and accept only a supported server-owned Driver/Host profile role. Local session comparisons are UI coherence checks, not a new server authorization boundary; existing Auth/RLS and profile grants remain authoritative.

Catch SDK/profile/session errors. Pre-acceptance failures remain explicitly retryable with no automatic retry. If Auth accepted signup but profile/session completion fails, clear the draft secret and route to sign-in with the email prefilled instead of offering another account creation. On success clear draft/credentials, retire old handlers before publishing once, and preserve closeOnAuth=false used by email flows.

No endpoint/admin access, database/schema/grant, credential, dependency, payment or legal-text change. Metadata/consent payload fields remain unchanged and do not authorize the published role. Current SDK shape/duplicate semantics checked against https://supabase.com/docs/reference/javascript/auth-signup and getSession documentation. No account lookup or account deletion is added.

Scope is modal signup handling. A sent SDK request may still create an account, establish a session, send mail and emit global Auth events after Close. This does not cancel/roll back signup, sign out users, atomically bind cross-tab sessions, or change the global synchronizer. Session checks are snapshots around the profile read. A failed/missing reply may follow successful creation: check email/sign-in before retrying. Client locking does not provide server idempotency across tabs/new modals. Recovery-event routing, existing email request/password-update handlers and Auth provider settings are unchanged.

## Verification

`test/qa-signup-request-context.test.js` runs actual compiled modal JSX with synthetic Auth/session/profile providers and controlled hooks. All 18 new checks pass; previous actual App fails 16 while two preservation checks pass. Existing 65 signup/profile/sign-in/password/email checks also pass.

Coverage: synchronous repeated creates, lock through profile/final session, Close/unmount at each boundary, rejected SDK/profile/session reads, accepted-signup recovery to sign-in, absent/foreign/invalid-role profiles, missing/different sessions, malformed authenticated SDK replies, normal Driver/Host payloads and server-owned roles, generic duplicate verification, explicit retry, guarded Back/consent, renewed role consent, stale role/Back/create callbacks, closeOnAuth=false, StrictMode and initial validation. No real accounts, passwords, emails, database rows or sessions are changed.

Local validation: all 967 tests, build and diff checks pass. Run full tests/build/diff checks, then native CI and captured full-schema rehearsal on the exact tree before QA-only deployment. Verify stable alias, exact SHA/readiness, served bundle and public/access checks without live signup/login/mail/password/payment/data mutations. Record final evidence in the PR. BetterQA real browser/provider/session/signup acceptance remains pending.

## BetterQA acceptance

1. Create approved QA Driver and Host accounts through fields → role → consent. Rapidly click I Agree & Create Account; expect one current request and a locked button through completion.
2. Back out before submitting, change role and confirm consent is unchecked. While submitting, Back and consent changes must be disabled; Close stays available.
3. Delay/reject signup, profile or session responses. Pre-acceptance failures allow explicit retry. After accepted signup with account-loading failure, expect sign-in with the email prefilled and password blank, rather than another Create request.
4. Close while waiting and release old results. Old modal callbacks must not authenticate, start follow-up profile reads or change a new dialog; the SDK/global Auth system can still finish a request already submitted.
5. Confirm unverified/duplicate registration guidance, email confirmation/resend/reset, normal sign-in and the existing 12-character policy. Test matching and changed/missing sessions around profile reads with no stale modal authentication.
6. Confirm ordinary authenticated signup, supported server-owned roles, and message/extension email flows preserving closeOnAuth=false. Use fresh approved QA accounts and check email/sign-in after uncertain replies before retrying.
