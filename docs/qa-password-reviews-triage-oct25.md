# QA password policy, written reviews and Triage reconciliation — 25 October 2026

This release stacks on QA commit 9b6d24bf8a51c625c3bb55e9285caa34d7a483b9.
Deploy only to ParkShare QA, project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC.
No database migration, financial write, email send, plan upgrade or production
deployment is included.

## BUG-005322 — application repair; server-side gate remains blocked

New signup and recovery passwords retain the 12-character minimum and now use
pinned zxcvbn 4.4.2 with a minimum score of 3. Its local dictionary and pattern
estimation reject the reported 123456789101112 sequence, repeated characters,
common passwords, keyboard runs and common substitutions. Passwords never go to
a scoring service. Several unrelated words can pass without arbitrary character
composition rules. Estimation considers at most the first 100 characters to
bound CPU work; the submitted secret itself is never truncated or normalized.
The signup draft is checked again immediately before registration. Recovery
checks run both in the form and before the account-bound Auth request. Existing
sign-in credentials remain eligible, and the token/account binding is preserved.

This is a browser policy, not enforcement against direct Auth API callers and
not a current breach-database lookup. The QA organization is on Supabase Free;
native leaked-password protection is a Pro-or-above feature and is currently
disabled. The available connector cannot update Auth configuration. Do not
close this security ticket or purchase/upgrade a shared organization implicitly.
Keep it Blocked pending an approved server-side control and direct signup/reset
API retests. Reference: https://supabase.com/docs/guides/auth/password-security .
The dictionary adds approximately 400 kB compressed to the existing app bundle;
this release does not change authentication architecture to avoid that cost.

Retest: weak examples must fail signup before role/consent, valid passphrases
must reach the existing verification flow, and old passwords must still sign
in. Both reset fields must retain the 12-character hint (BUG-005224). Repeat
account switches, close/unmount and rapid submits with controlled QA accounts.
Server-side acceptance remains separate and unverified.

## BUG-005325 — authenticated written review display

The saved text was intact; the anonymous summary endpoint intentionally omitted
it because free text can disclose private addresses and access instructions.
A new authenticated GET /api/listing-reviews returns written text only to the
listing Host or a Driver with a confirmed/completed paid booking and a checkout
reference, using the existing precise-location permission helper. Cancelled,
refunded, unpaid, unrelated and signed-out callers cannot obtain written text.
Unentitled reads select only rating/date, and the final projection independently
strips text and reviewer identifiers. All authenticated responses are private,
no-store and vary by Authorization. The anonymous endpoint remains ratings-only.

The listing uses the matching account token, checks session ownership before
and after fetching, binds rows to account/listing/revision and aborts obsolete
reads. React renders plain text with preserved line breaks and word wrapping;
no HTML interpretation is used. Submission still requires a completed paid stay,
one review per Driver/listing, and excludes self-reviews. Failed reads remain
retryable and never claim an empty review history.

BetterQA: reproduce with the reported completed paid Driver, reload after
submission and confirm text/stars together. Check Host access, a second entitled
Driver, <script> text rendered literally, line breaks, account changes, sign-out,
network failure and retry. Search cards keep their existing aggregate rating.
Public visitors receive a clear explanation of the written-review restriction.
The report also asks for pre-booking public written reviews; that broader scope
requires an approved moderation/publication design and is not claimed here.
Ready for QA refers to the reported entitled-Driver display and privacy checks.

## Remaining Triage tickets reconciled against current QA source

These fixes already existed in the stacked source. Ready for QA means ready for
BetterQA acceptance, not passed, released or closed. Do not rewrite old emails.

| Ticket | Existing repair and evidence | Focused BetterQA retest |
| --- | --- | --- |
| BUG-005323 | `_refund-email-context.js`, `qa-refund-notifications-005249.test.js`: prominent cancellation, stored actor and reason, distinct partial/extension wording | Fresh Driver and Host cancellations, both emails; missing reason, CAD/reference, partial and extension refunds |
| BUG-005313 | `qa-driver-refund-details-005313.md` and corresponding tests: title plus Parking/Paid dates in property zone | Refunded own history, scheduled/paid on different days, timezone and missing-listing cases; exact addresses remain restricted after cancellation |
| BUG-005312 | `availabilityExceptionDates.js`, `qa-exception-horizon-005138.test.js`, database tests; QA migration 20261021200835 confirmed applied | Both date inputs, inclusive 12-calendar-month boundary, leap days, property timezone and direct-write rejection |
| BUG-005270 | `qa-email-footer-social-links-005270.md`, rendered email tests | Fresh five email variants, removed broken Facebook/X/LinkedIn anchors, retained website/support and ParkShare YouTube |
| BUG-005268 | Reserve row wraps items; button has nowrap and no shrinking; signed-out notice below row. Added CSS/structure regression | Cross-tab sign-out on narrow/mobile and desktop widths; readable disabled button and preserved selection |
| BUG-005259 | `qa-email-spot-layout-005259.md`, real PNG and webhook/reminder tests | Fresh 1–8 physical layouts, private bays, Spot H, all five email variants; no phantom bays |
| BUG-005258 | `qa-host-onboarding-005258.md` and corresponding tests | Driver CTA explanation, cancel, explicit sign-out then Host signup/sign-in, existing Host and signed-out visitor |
| BUG-005227 | `qa-bookings-account-response-isolation-oct20.md`, actual cover handler tests | My Bookings authorized Storage/legacy images, missing image fallback, no function crash and cross-account denial |
| BUG-005225 | Same repaired cover-handler parsing/authorization path as BUG-005227 | Booking confirmation image, correct booking owner, unrelated booking denial, graceful missing/corrupt image |
| BUG-005224 | Signup/recovery use shared minimum constant and 12-character placeholder; recovery regressions | New password hint says 12, short password fails, stronger pattern checks apply, existing sign-in works |
| BUG-005168 | `qa-ui-polish-005162-005164-005168-oct19.md`, compiled component tests | Successful empty Driver Bookings/Messages/Transactions have Find parking links; loading/error states do not claim empty histories |

## Verification and operational limit

Run full native tests, Vite build, GitHub PostgreSQL-backed tests/build and
full-schema rehearsal on the exact release commit. Actual HTTP handler tests
intercept synthetic transports; they do not create accounts, charge/refund,
send emails or read hosted private reviews.

The pre-existing QA Auth/Data API readiness failure remains an interactive
acceptance blocker. A successful build or local test is not an end-to-end
booking/password/email result. Confirm the deployed commit and record readiness
honestly in BugBoard. Do not restart Supabase or change its compute/plan here.
Rollback is a QA redeployment of the parent source; no data rollback is needed.
