# Payment emergency alerts — preparation, November 13, 2026

Status: isolated draft based on frozen `072629e`. Production, frozen QA and
PR 254's separate review remain unchanged. No hosted outbox installation,
configuration change, scheduler activation, payment, refund, transfer or
webhook replay was performed. One owner-approved synthetic TEST email was
sent through the existing email connection; the application worker was not
activated to send it.

## Owner decisions

- Brian selected an emergency mailbox on November 13. Configure its exact
  value privately as `PAYMENT_ALERT_EMAIL_TO`; keep the personal address out
  of this public repository.
- Vancouver is assumed included at launch. BUG-005674 remains a blocker until
  diagnosed, repaired and independently verified. Observed canonical UTC
  records and a simulated older browser timezone database are investigation
  evidence, not a confirmed diagnosis. Preserve historical booking records.

## Prepared behavior

| Signal | Alert | Existing financial result |
| --- | --- | --- |
| Signed webhook processing throws | Webhook failure, or paid-checkout reconciliation | Keep HTTP 500 for Stripe retry |
| Registered paid initial booking is retained as rejected | Checkout not applied; inspect reversal/refund audit | Keep existing settlement/reversal rules |
| Refund or Host fee operation enters review | Staff reconciliation required | Keep the review hold |
| Refund/fee worker catches an error | Processing needs investigation | Keep the operation pending |
| Signed `refund.failed` or failed `refund.updated` | Refund failed | Keep normal account-scoped ledger reconciliation |

No alert repairs a booking or submits a financial operation. A paid Checkout
or rejected-booking event is not proof that funds remain captured: inspect
the original connected-account Charge, refunds and dispute before acting.
Unregistered connected-account payments are not classified as ParkShare
bookings. Invalid signatures cannot enqueue emergency emails.

Only allowlisted correlation IDs and a booking number enter the message.
Customer details, addresses, plates, raw payloads, error text and credentials
are discarded. LIVE and TEST appear explicitly in the subject.

## Durable delivery repair

The original direct-send draft could lose a notification when the mail
provider failed, particularly after a refund operation entered review. The
new reporter records an immutable payload and deterministic key in a
service-only outbox. It does not send mail inline with the financial path.
The queue RPC has a 2.5-second request timeout.

A separate authenticated `/api/send-payment-alerts` worker handles emails
only. It never calls the reminder, refund or reimbursement workers. No
scheduler is added to `vercel.json`.

- A database lease permits one worker to claim each job for two minutes.
- The original payload, recipient, sender, first-attempt time and key survive
  restarts. JSONB key reordering cannot change the idempotency key.
- Failed responses and ambiguous acceptance retry with that same payload/key.
  Backoff starts at 30 seconds and caps at one hour. Numeric Retry-After is
  honored within that cap. Concurrent provider requests retry; payload
  conflicts and other permanent rejections block for operator review.
- At most eight attempts are allowed, including claims after worker crashes.
  Each run handles at most five jobs, sequentially.
- Ambiguous jobs block after 23 hours, before Resend's documented 24-hour key
  retention expires. They require reconciliation rather than automatic
  re-keying. Reference: https://resend.com/docs/dashboard/emails/idempotency-keys
- Provider acceptance is recorded durably. Accepted jobs do not resend after
  the provider cache expires. Acceptance is not proof of inbox delivery.
- A changed recipient/sender, mode mismatch or payload/key corruption blocks
  the saved job. No frozen payload is silently redirected or edited.

The schema proposal is `docs/sql-proposals/payment-emergency-alert-outbox.sql`.
It creates an empty table, with RLS and no anonymous/authenticated grants.
Its fixed-search-path functions are SECURITY INVOKER and service-only. It
adds no historical jobs or triggers on financial tables. It is not included
in the existing PR 253 production migration package. Incorporating it into
an approved release is a separate step; it has not been applied to hosted
production or active QA.

## Runtime gate — off by default

Later configuration requires all of the following; none are enabled here:

- `PAYMENT_ALERTS_ENABLED=true` and `PAYMENT_ALERTS_ENVIRONMENT=production`
  or `qa`.
- `PAYMENT_ALERT_EMAIL_TO` set privately to the approved monitored mailbox.
- Explicit verified-domain `EMAIL_FROM`, existing `RESEND_API_KEY` and
  service-only database credentials.
- Exact expected Vercel project and Supabase URL, and matching Live/TEST key
  prefix. Live alerts additionally require the Production target.
- The reviewed outbox schema and exactly one separately approved scheduler
  for the email-only drain, using the existing `CRON_SECRET` authorization.

These guards do not prove current production key or signing-secret
isolation. Exact production sender and APP_URL remain separate evidence.

## Verification and controlled TEST delivery

`node scripts/preview-payment-alerts.mjs` renders six synthetic messages
locally without a provider call. JavaScript fixtures test queuing, crashes,
ambiguous acceptance, duplicate protection, backoff, blocked cases, mode
isolation and preserved financial responses. Native disposable PostgreSQL
checks exercise real grants/RLS, competing lease claims and retry state.

Controlled transport test, November 13, 2026 at 23:44:44 UTC:

- Used the established `ParkShare QA <qa@myparkshare.ca>` sender and the
  privately approved emergency destination.
- Subject explicitly stated TEST and that no payment incident existed.
- The provider reported **delivered**. Repeating the identical request/key
  returned the same provider message ID, rather than a second message.
- Brian confirmed inbox receipt and supplied a matching screenshot for the
  same TEST reference. The personal address, message ID and screenshot
  remain private.

This proves the existing email connection's transport to the selected
mailbox. It does not prove the deployed application reporter, outbox worker,
production configuration or scheduler. No real financial action was used.
Before activation, rehearse the complete application-to-outbox-to-worker
path in an isolated review environment, then record exact source/deployment,
UTC time, queue/lease state, provider acceptance/delivery and owner receipt.
Do not change frozen QA or replay BetterQA's financial events for this test.

## Operator response and remaining launch gate

Brian is the initial incident owner; a backup is not yet nominated. Inspect
mode, connected account and event/session/operation references before a
controlled retry. Preserve history and reconcile actual provider results
before any manual refund, reimbursement or booking correction.

The disposable application/database-API/worker rehearsal is described in
`docs/payment-alert-integration-rehearsal-nov13.md`. It requires no hosted
target and sends only to a loopback provider simulator. Its results do not
activate or certify the deployed production path.

The production payment-alert checklist item remains open. Review and
separate application/schema rollout, full-path TEST evidence, scheduler
selection and production activation are still required. Blocked jobs need
operator review and a monitored health/escalation procedure.

This queue protects notifications after successful enqueue. A database outage
can still prevent the initial enqueue, and an outage before application
execution or an event never delivered by Stripe is outside this path.
Queueing is separate from the financial transaction; a failed enqueue after
an operation enters review requires reconciliation from its retained audit.
Preserve the existing logs and Stripe retries. Independent outage and stale-
queue monitoring remain necessary before relying on this as the sole
emergency channel. No exactly-once lifetime delivery guarantee is claimed.
