# BUG-005527 — private Driver session reminders

## Repair

The halfway and ending-soon reminders are Driver-only. The scheduler no longer
loads the Host's contact details or passes a Host CC. The reminder delivery
worker independently builds a single-Driver payload, ignoring extra addressing
from callers. Booking and extension Host notifications retain their separate
recipient-specific delivery paths.

The worker also checks immutable stored requests before a provider attempt.
An unaccepted snapshot with CC, BCC, Reply-To, multiple recipients or a different
Driver address is suppressed for reconciliation. It is not edited or sent with
a replacement idempotency key: a lost earlier provider response could otherwise
cause a duplicate or replay the address disclosure. Previously accepted rows
can repair their booking marker without another email. Existing leases,
retry deadlines, session checks and provider keys are retained.

## Verification

- Real cron-handler tests capture actual Resend payloads for both reminder
  types, verify one Driver recipient and no CC/BCC/Reply-To, and assert no Host
  profile lookup. They retain inline vehicle/spot artwork, local times, booking
  links and once-only behavior across repeated runs.
- Worker tests exercise extra caller addressing, legacy stored recipient
  variants for both reminder kinds, accepted legacy marker recovery,
  concurrent claims, provider errors and immutable retries.
- Forty-six focused checks passed. The new privacy checks fail on the prior
  source and pass with this repair. No real emails were sent by these tests.
- A read-only QA query found one unaccepted old Host-CC snapshot: booking 68's
  halfway reminder, whose session ended October 30. No historical delivery,
  booking, provider receipt or database schema was changed.

## BetterQA retest

Use the isolated recovery QA site and Stripe TEST mode. Make a fresh one-hour
booking with distinct Driver and Host accounts. Around 30 and 45 minutes after
the canonical start, respectively:

1. Verify the Driver receives one halfway and one ending-soon reminder.
2. Inspect each message's recipients/headers: only the Driver is a recipient;
   the Host address is absent from CC, BCC and Reply-To and from the body.
3. Verify the Host receives neither Driver reminder. The separate booking
   confirmation is expected and must not be confused with a session reminder.
4. Verify booking number, vehicle, bay, property-local departure and recovery
   QA links. Later scheduler ticks must not duplicate either reminder.
5. Repeat with Schedule for Later. Cancelled and ended sessions must remain
   suppressed.

Provider acceptance and inbox receipt are separate checks. BetterQA's fresh
inbox/header acceptance remains pending. Keep this change on the recovery QA
branch with the existing pull request draft and unmerged.
