# Password-recovery update handling — 20 October 2026

## Confirmed defect and repair

Code-identified defect; no assigned BetterQA issue number. Recovery's updateUser await had no catch/finally. An unexpected rejection left loading true and escaped the event handler. Enter in the confirmation field bypassed the disabled button and could start another password update. Pending fields could change, obsolete results could change the screen after Close/unmount, missing SDK data could claim success, and successful recovery retained passwords in component state. The placeholder also incorrectly advertised six characters while validation already required twelve.

Extend the existing sign-in attempt ref to a shared credential-attempt ref. Recovery takes its synchronous lock before awaiting Auth and retains it until current failure or success. Capture the submitted password, disable/guard both fields, catch returned and rejected failures, and release current failures for explicit retry. Check the existing modal/screen/attempt ownership before applying replies. Close, unmount and StrictMode cleanup invalidate queued submits and late UI results. There are no automatic retries.

Require an SDK success reply containing a nonempty string user ID, with no error, before entering the success screen. Use the existing immediate screen-transition helper to retire queued handlers and clear both secrets, validation and pending state before React commits success. Continue now uses the standard guarded close handler. Recovery is a real form with associated labels, password autocomplete, accessible errors, and the existing twelve-character minimum; Enter follows the same guarded submit handler as the button.

The underlying authenticated update remains supabase.auth.updateUser({ password }); API shape verified against https://supabase.com/docs/reference/javascript/auth-updateuser. No new Auth endpoint/admin access, recovery-email or resend change, dependency, credential, database/schema/grant or payment change. Existing sign-in session/profile checks are preserved under the renamed shared ref.

Scope is recovery UI request handling. A request already submitted may still update the password, update the SDK session and emit global Auth events after the dialog closes; this is not remote cancellation, rollback or sign-out. Missing replies are not proof that the password stayed unchanged: try signing in with the new password before requesting another reset. Recovery event routing, account/session selection, cross-tab identity changes, initialScreen propagation into an already mounted modal, SDK/global synchronizer internals, signup/resend and reset-email-request internals are unchanged. No stronger session binding is claimed.

## Automated verification

`test/qa-password-update-context.test.js` compiles the actual modal JSX with controlled hooks and synthetic updateUser replies. It exposes the form submit Promise only for awaiting; handler logic is unchanged. The previous JSX's actual button handler is used for comparison. All 13 checks pass; the previous actual App fails all 13 checks. Behavioral reproduction includes rejected update, duplicate submissions, pending field changes, missing acknowledgement, writes after Close/unmount and retained secrets. Structure checks additionally cover real form, labels, autocomplete and matching password policy.

The 17 existing actual sign-in checks also pass. Coverage includes returned errors and explicit retry, malformed/null replies, late success/error after Close, fresh-dialog isolation, unmount, stale queued handlers immediately after success, secret clearing, Continue, StrictMode replay and password validation. SDK responses/navigation are synthetic. No real password, session or account is changed in these tests.

Local validation: all 923 tests, build and diff checks pass. Run the full `npm test` suite, build and diff checks, then native CI and the disposable full-schema rehearsal on the exact candidate tree. Deploy only parkshare-qa and record release evidence in the PR. Public/static/readiness/access checks verify the release without logging in, sending recovery mail or updating a live password. Real recovery browser/session acceptance remains pending for BetterQA.

## BetterQA acceptance

1. Use an approved QA recovery account and reset link. Confirm both labels, twelve-character hint, mismatch/short-password errors and Enter/button submission.
2. Delay the Auth response and rapidly press Enter/click Update. Expect one update, disabled password fields and no value changes while pending.
3. Inject a rejected promise or returned Auth failure. Expect a visible error and an unlocked form; a deliberate retry can complete. No automatic retry should occur.
4. Supply a malformed/no-user SDK reply. Expect uncertainty guidance rather than success. Check sign-in with the new password before repeating a reset.
5. Delay a reply, close the dialog and reopen it. Releasing the old success/error must not change the new dialog. A request already sent can still update the account and emit global Auth events.
6. Confirm success clears both secrets, appears once and Continue closes normally. Retest normal Driver/Host sign-in and extension/message email sign-in since they share credential request ownership.
