# BUG-005249 — Recovery Preview notification scheduler

## Verified root cause
The refund-email sender and separate Driver/Host templates are present in recovery
commit 4dc271dc1735c4180f4c2abfb3e59074fba6bdc6. Successful Stripe refunds are
reconciled and queue two audience-specific refund_email_deliveries rows. The new
recovery jobs have no first_attempt_at, provider_id or sent_at.
Vercel Cron targets Production deployments, not this isolated recovery Preview.
The worker therefore never attempted these messages; this is a scheduling gap.

## QA-only repair
Enable pg_cron and pg_net only in recovery Supabase heqxirlsorcztsawaldg.
Two minute jobs invoke the fixed recovery branch URL's existing authenticated
send-refund-notifications and send-reminders handlers. The existing branch-only
CRON_SECRET is securely copied server-to-server to encrypted Supabase Vault by
scripts/qa-recovery-preview-workers.mjs. No credential is printed, requested from
the owner, committed, returned by the RPC, or embedded in cron command text.
Anonymous/authenticated access to the bootstrap function and Vault contents is
denied. pg_net is a managed schema: its internal table grants are not alterable by
the project postgres role. The provisioning script therefore also requires an
anonymous PostgREST probe to return 406/PGRST106 for the net schema before storing
any credential. Both app roles lack direct database login. Drop the bootstrap function after successful provisioning.

The script refuses the wrong Vercel project, branch, environment, Supabase project,
APP_URL or non-TEST Stripe key before making any network request. Five focused
checks exercise those guards and secret-redacted failures. Full app regression,
build, real scheduler HTTP responses and provider acceptance are separate gates.

Existing successful refund ledger entries alone drive queued mail. No new refund,
payment replay, manual booking insertion, paid-hold cleanup, or production change
is part of this repair. The two historical blocked refund jobs remain blocked.
Application notification idempotency, leases and retry deadline remain intact.

## Verification / BetterQA
Check each scheduled handler returns HTTP 200 and queued recovery emails receive
distinct provider IDs and sent_at values. Provider acceptance is not inbox proof:
BetterQA must confirm receipt by each audience, private recipient headers, correct
cancelling actor/reason, booking reference, refunded amount and reservation outcome.
Create one fresh eligible Driver cancellation and one Host cancellation; expect
two private cancellation/refund messages within the scheduled delivery interval.
Check reminders on a fresh timed booking. Do not replay payments to test email.

## Disable before stable-QA cutover
In this recovery database only:
- cron.unschedule('parkshare-qa-recovery-refund-emails')
- cron.unschedule('parkshare-qa-recovery-booking-reminders')
Remove the Vault entry parkshare_qa_recovery_preview_cron after both jobs stop.
Do not run this QA infrastructure SQL in production migrations.

## Stripe fees — technical behavior, not a newly approved policy
Connected TEST accounts are Standard with controller.fees.payer=account.
The cancellation route creates a full original-payment refund with
refund_application_fee=true on that same connected account. The Driver should
receive the original total including ParkShare's application/service fee.
Stripe retains original processing fees under standard pricing; they remain
the connected Host account's cost under this configuration. This is distinct
from ParkShare retaining its own service fee. Do not net that Stripe cost from
a promised full Driver refund, or record refunded gross as Host earnings.

public/legal.html does not explicitly allocate retained processing fees for
cancelled bookings. Owner approval/disclosure of the commercial allocation,
especially platform-error cancellations, is a separate launch decision.
No fee policy, compensation transfer or refund amount was changed.

Official sources:
https://vercel.com/docs/cron-jobs
https://supabase.com/docs/guides/functions/schedule-functions
https://supabase.com/docs/guides/database/vault
https://stripe.com/en-ca/pricing
https://docs.stripe.com/connect/direct-charges-fee-payer-behavior
