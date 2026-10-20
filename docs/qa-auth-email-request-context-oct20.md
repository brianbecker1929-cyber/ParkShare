# Auth email request ownership — 20 October 2026

## Confirmed defect and repair

Code-identified defect; no assigned BetterQA issue number. Confirmation resend depended on React state for its pending/cooldown checks, so queued handlers could send twice. Reset-email requests had no pending/cooldown guard and only checked for an @ character. Both could publish late success/error/loading updates after Close, screen navigation or unmount. Cached handlers could use an older email after an A -> B -> A edit. Verification-to-sign-in buttons also wrote the old address after an obsolete transition.

Use a synchronous shared auth-email attempt lock across confirmation/reset requests, and prevent email requests from overlapping credential sign-in. Lock sign-in fields and controls while email is pending. Capture and trim a fully validated email. Own requests by modal, screen and email revision; invalidate on Close, navigation, email edit or cleanup. Suppress obsolete UI replies/loading cleanup and queued sends. Clear address-specific messages when the email changes.

After an SDK acknowledgement, enforce one minute between requests of the same kind within this modal, using a ref instead of stale render state. Confirmation and reset have independent timestamps; server failures remain explicitly retryable. Record acknowledged request spacing even if its UI was retired. Missing/malformed SDK results show uncertainty guidance, not claimed success or a confirmed-send cooldown. No automatic retries.

Return a fresh screen owner from the existing transition helper and explicitly transfer the verification Reset action to sign-in, retaining the entered email. Old verification action callbacks cannot write or send again. Keep unconfirmed-email guidance present during confirmation resend so its button remains available for errors/retry. Preserve generic eligible-account messaging and same-origin confirmation/reset link options.

No new Auth endpoint/admin access, provider credentials, mail template, database/schema/grant, dependency or payment change. Existing SDK call/response shapes checked against installed auth-js and official docs: https://supabase.com/docs/reference/javascript/auth-resend and https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail. Existing synthetic signup fixture now returns the real SDK's data/error:null acknowledgement shape.

This is client request handling and spacing within a modal, not server idempotency or rate limiting across tabs/reloads/new modals. Closing/navigation cannot retract a submitted email request; it may still send. SDK acknowledgement does not establish account existence or inbox delivery. Missing replies may follow a successful send: check the inbox before retrying. Signup, password-update internals, recovery routing/session selection and the global Auth synchronizer are unchanged.

## Verification

`test/qa-auth-email-request-context.test.js` executes the actual compiled modal with controlled hooks/Auth/time and no real mail. All 26 checks pass; the previous actual App fails 25, while the preserved request-option check passes. Tests cover synchronous repeated/cross-kind requests, one-minute boundaries through cached handlers, stale email A -> B -> A, pending fields/credential actions, Close/screens/unmount, SDK error/rejection, malformed acknowledgements, explicit retry, StrictMode, full-email validation, same-origin options, verification reset ownership transfer and stale verification actions. Existing 39 sign-in/password-update/signup-profile checks also pass.

Run the full test suite, build and diff checks, then native CI and the disposable full-schema rehearsal on the exact candidate tree. QA-only deployment must report the tested SHA/readiness and pass public/static/access checks. No live login/signup/password update, reset/confirmation mail, valid support/event submission, payment or private-row comparison is performed during release verification. Real mailbox/browser/provider acceptance remains for BetterQA.

## BetterQA acceptance

1. On an unconfirmed QA sign-in, rapidly press Resend; expect one pending request, disabled credentials/actions and generic confirmation guidance. Repeat on verification after signup.
2. Rapidly press Forgot password/Reset; expect one pending reset request. Verify the verification-screen Reset action lands on sign-in with the original email and shows the generic reset guidance.
3. After a confirmed request, repeat within one minute and at/after one minute. Same-kind requests must wait; confirmed resend and reset use independent spacing. Inject a failed SDK request and retry explicitly without an automatic retry.
4. Delay an email reply, Close or switch screens, then release success/error. The new dialog/screen must not show the old message or be unlocked by old cleanup. A submitted email request may still send.
5. Change email A -> B -> A after completion/failure; old address messages and queued callbacks must not return. Pending fields remain locked.
6. Test malformed/no-acknowledgement replies, actual QA inbox links and same-origin redirects. Retest normal Driver/Host sign-in, pending-signup recovery and the password-update form.
