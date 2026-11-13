# Payment emergency alerts — preparation, November 13, 2026

Status: isolated draft based on frozen `072629e`. No deployment, hosted
configuration change, migration, scheduler activation, replay or email send.
The existing PR 254 review, production and frozen QA are separate.

## Owner decisions

- Brian selected an emergency mailbox on November 13. Configure its exact
  value privately as `PAYMENT_ALERT_EMAIL_TO`; do not put a personal address
  in this public repository.
- Assume Vancouver is included at launch. BUG-005674 remains a launch blocker
  until its cause is established, repaired and independently verified.
  Observed canonical UTC records and a simulated older browser timezone
  database are investigation evidence, not a confirmed diagnosis. Do not
  shift historical records or change the frozen build on that basis.

## Prepared behavior

| Signal | Email | Existing financial result |
| --- | --- | --- |
| Signed webhook processing throws | Webhook failure, or paid-checkout reconciliation alert for a paid Checkout event | Keep HTTP 500 for Stripe retry |
| Registered paid initial booking retained as rejected | Checkout not applied; inspect reversal/refund audit | Keep existing settlement/reversal rules |
| Refund or Host fee operation enters review | Staff reconciliation required | Keep the review hold |
| Refund/fee worker catches an error | Processing needs investigation | Keep the operation pending |
| Signed `refund.failed` or failed `refund.updated` | Refund failed | Keep normal account-scoped ledger reconciliation |

No alert submits a financial operation or repairs a booking. A paid Checkout
event or rejection is not proof that funds remain captured: inspect the
original connected-account Charge, refunds and dispute before acting.
Unregistered connected-account payments are not classified as ParkShare
bookings by this change. Invalid signatures never trigger emergency emails.

Only correlation IDs and a booking number are included. Raw event payloads,
customer details, addresses, plates, error messages and credentials are
discarded. LIVE and TEST are explicit in the subject. Email failure does not
change the existing financial outcome; the provider request has a 2.5-second
timeout and no inline retry.

## Runtime gate — off by default

No settings are created by this draft. Later configuration requires:

- `PAYMENT_ALERTS_ENABLED=true` and `PAYMENT_ALERTS_ENVIRONMENT=production`
  or `qa`.
- `PAYMENT_ALERT_EMAIL_TO` set to the owner-approved monitored mailbox;
  one recipient, no CC/BCC.
- An explicit `EMAIL_FROM` mailbox on verified `myparkshare.ca`, plus the
  existing `RESEND_API_KEY`. Confirm the actual production sender separately.
- Exact expected Vercel project and Supabase URL, and matching Live/TEST key
  prefix. Live alerts additionally require Vercel Production target.

These runtime checks are guards, not evidence of the current production key
or signing-secret isolation. No secret comparison is performed here.

## Local verification and safe delivery rehearsal

`node scripts/preview-payment-alerts.mjs` renders six synthetic TEST messages
locally without using credentials or a network. Tests inject a fake email
transport; no external email is sent. The configured emergency mailbox is
not tested by this offline exercise.

Before activation, use a separate review build and a synthetic signed TEST
fixture with a stubbed failing dependency, not a real charge or refund. Send
one clearly labelled TEST notification to the approved mailbox, confirm its
arrival, and inspect the redacted provider delivery status. Repeat the same
fixture to verify duplicate handling. Record exact source/deployment, test
time in UTC, accepted message ID, delivery evidence and mailbox receipt.
Coordinate any BetterQA retest separately; do not modify its frozen target.

Provider deduplication uses an identical body and stable key for an identical
incident. Resend documents a **24-hour** idempotency retention period:
https://resend.com/docs/dashboard/emails/idempotency-keys
After that window another notification can be sent. Different signed events
about the same incident can produce separate notifications. This is not a
durable incident queue and does not promise exactly-once lifetime delivery.

## Operator response

Brian is the initial incident owner. A backup operator is not yet nominated.
Suggested launch procedure: investigate a LIVE alert promptly; match mode,
connected account, event/session/operation and booking audit first. Preserve
history and record an incident note before considering a controlled retry.
Check actual provider results before any manual refund, reimbursement or
booking correction. Avoid automatic replay while a disputed or ambiguous
payment is being reconciled.

## Remaining production gate

This draft does **not** close the production payment-alert checklist item.
It requires review, coordinated application release, destination/sender
configuration and actual TEST delivery evidence, then approved production
activation. It does not catch failures before the application executes,
events never delivered by Stripe, silent stale queues, or a simultaneous
Resend outage. Preserve the existing logs and Stripe delivery monitoring;
independent monitoring, durable retry/escalation and rate-limit policy remain
required review decisions before relying on this as the sole emergency path.
