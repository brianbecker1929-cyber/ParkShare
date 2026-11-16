# Emergency alert health monitoring — November 16, 2026

Status: separate draft stacked on alert PR #256 at `d5a2791`. No merge,
hosted schema change, production/frozen-QA deployment, scheduler activation,
secret creation or real email/payment/refund/transfer is part of this work.
All automated failure exercises use disposable local CI resources and an
email-provider simulator. The emergency mailbox remains the owner's
previously approved private destination; no backup contact is assumed.

## What is monitored

| Condition | Detection |
| --- | --- |
| Worker never ran | No completed-run heartbeat for the selected mode |
| Worker stopped | Last completed run is more than five minutes old |
| Last batch had failures | Completion records a nonzero failed-job count |
| Old pending alert | An unaccepted, unblocked job is at least 15 minutes old, even if provider backoff has postponed its next attempt |
| Blocked alert | An unresolved blocked job requires operator review |
| Database/API or schema failure | The probe cannot read its mode-scoped summary |
| Application/domain/network failure | Independent request fails, times out or returns an invalid response |

The worker records a server-clock completion only after its email drain
finishes. Failed drains do not claim successful completion. A failed heartbeat
write returns an unhealthy worker response; accepted emails retain their
existing outbox protection. The health probe never advances the heartbeat.
Queue and heartbeat queries have 2.5-second client deadlines.

## Separation and access

- `api/payment-alert-health.js` requires its own random secret of at least
  32 characters, different from `CRON_SECRET`. It allows GET only and returns
  private/no-store responses containing summary counts, timestamps and fixed
  issue codes. It cannot run a worker, change a job or trigger a financial action.
- The new review-only SQL proposal creates an initially empty heartbeat table
  with RLS and service-only grants. Both functions use SECURITY INVOKER with
  an empty search path. The read RPC returns no customer details, message
  bodies, booking references, payment identifiers or credentials.
- The external checker uses a dependency-free protocol module. It has no
  Supabase, Stripe or worker credential. Its allowed destination URLs are
  fixed for production and recovery QA. HTTP redirects are rejected, request
  deadlines are eight seconds and response bodies are capped at 8 KiB.
- Each response must match a fresh probe reference, current timestamp, expected
  environment/mode and protocol version. Counts and heartbeat are independently
  checked; an inconsistent healthy flag is rejected.

## Independent notification

The proposed GitHub Actions checker runs outside the application/database
path. When unhealthy, it calls the existing email provider directly instead
of adding a job to the queue it is checking. Logs contain fixed issue codes
only; the generic email contains no incident payloads or credentials.

The fixed message and deterministic key deduplicate repeated or changing
symptoms within each UTC 30-minute window. The next window is an intentional
reminder if the problem remains. Two window notifications can therefore be
close together across a boundary. A provider's uncertain result is not called
delivered; the next check retries the same window's body/key. No expired
window is replayed. Acceptance is not inbox delivery confirmation.

Healthy checks send no mail. Unhealthy checks still exit nonzero even when
the email provider accepts the warning, so the workflow remains visibly
failed. Provider rejection/outage leaves an unhealthy result and requires
operator escalation using the failed workflow as a fallback signal. Verify
GitHub failure-notification settings and delivery before activation; that
delivery path has not been confirmed by this draft.

## Off until reviewed activation

The workflow is prepared for five-minute checks offset from the top of the
hour, with one concurrency group and a two-minute job timeout. It runs only
from the repository's reviewed default branch and only when the explicit
repository variable `PAYMENT_ALERT_MONITOR_ENABLED` is `true`. It has no PR
trigger and read-only repository permissions. Actions are pinned by commit.
Nothing enables that variable or installs configuration here.

At a separately approved rollout:

1. Deploy/review PR #256 plus this dependent change, installing the outbox
   proposal first and then `docs/sql-proposals/payment-alert-health.sql`.
   Include both in the reviewed production migration package before applying
   anything; they are not automatically part of PR #253.
2. Set a distinct `PAYMENT_ALERT_MONITOR_SECRET` privately on the application
   and independent runner. Configure the runner's explicit mode (`qa` or
   `production`), the approved private `PAYMENT_ALERT_EMAIL_TO`, a verified
   `PAYMENT_ALERT_MONITOR_FROM`, and a domain-scoped send-only provider key
   as `PAYMENT_ALERT_MONITOR_RESEND_KEY`. No worker/database key belongs in
   this workflow. No credential is created by this draft.
3. Run one authorized drain and verify the matching completed heartbeat and
   a healthy read-only probe. The eventual worker schedule remains a separate
   approved activation; this monitor does not create it.
4. Rehearse the deployed TEST path with synthetic fixtures, including an
   unavailable probe and actual inbox receipt. CI simulation and the earlier
   transport-only email receipt do not certify this deployed path.
5. Install the reviewed checker/workflow on the default branch, verify exact
   source/target bindings, then enable its flag and observe a real scheduled
   run. Scheduled workflows are best effort and may be delayed.

## Operator response

Brian is the initial owner. For a failure, check the sanitized workflow issue
codes, then use authorized application/Stripe dashboards to investigate.
For blocked or stale jobs, reconcile existing provider acceptance and the
immutable payload/key before choosing any manual action. Never re-key an
uncertain email or automatically replay financial operations from a health
warning. Record the decision and escalation; nominate a backup separately.

## Limits

This detects ongoing outages during checks and persistent worker/queue
problems. It cannot detect an outage entirely between samples, recover a
never-enqueued incident, or prove inbox delivery. Queueing is still separate
from financial settlement; retained audits, logs and Stripe retries remain
necessary. GitHub Actions outages, disabled schedules, repository activity
rules and simultaneous provider failures need a separately chosen independent
dead-man channel before claiming continuous emergency coverage. No additional
provider or paid service is provisioned by this draft.

References verified November 16:

- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- https://docs.github.com/en/actions/how-tos/troubleshoot-workflows
- https://resend.com/docs/dashboard/emails/idempotency-keys
- https://supabase.com/docs/guides/database/postgres/row-level-security
