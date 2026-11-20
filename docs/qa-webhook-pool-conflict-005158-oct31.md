# BUG-005158: refund revision conflicts exhaust the recovery API pool

Scope: isolated recovery QA (`heqxirlsorcztsawaldg`), branch
`qa/recovery-preflight-oct27`, Stripe TEST. Keep PR 252 draft and do not
merge/deploy to production.

## Evidence collected October 31

- Recovery runs PostgREST 14.18. `reconcile_payment_refunds` raises SQLSTATE
  `40001` when the caller's refund revision no longer matches the locked row.
- That is an application conflict: retrying the same RPC arguments can never
  make its old expected revision current. PostgREST 14 automatically retries
  serialization errors, including user-raised `40001`, without returning the
  refusal to the caller. Supabase documents this exact failure mode:
  https://github.com/orgs/supabase/discussions/50151 and
  https://github.com/PostgREST/postgrest/issues/3673.
- Recovery recorded over 339 million service-role transaction-context setup
  calls since October 28; the count was still increasing during inspection.
  Other application queries had only thousands of successful executions.
- Actual recovery `checkout.session.completed` requests at 14:00:56,
  14:01:32 and 15:02:04 UTC on October 31 failed with statusless `PGRST003`,
  "Timed out acquiring connection from connection pool." The same exhaustion
  affects refund, expired-session and scheduled worker requests.
- The 15:02 failure's event was `evt_1UWcp316hh5S3KsQzzutx2P8`, on recovery
  deployment `dpl_7LaF5BCjcn2jhv1471zEkHrvQVvH`. Its account/session have no
  registered recovery Host, hold, pending extension or booking. This observation
  is evidence of pool exhaustion, NOT proof of a missing registered paid booking.

## Repair

`20261031185643_webhook_refund_conflict_005158.sql` replaces only the stale
revision exception with `PT409`, detail `refund_snapshot_stale`. PostgREST
returns HTTP 409 rather than endlessly repeating that transaction. The caller
still fails the webhook for a refused financial snapshot, so a genuine Stripe
redelivery obtains a fresh row revision and current Stripe history.

The migration checks the existing definition before replacing it, is repeatable,
and asserts that function ownership, grants, invoker security and configuration
are identical. It does not change booking/refund rows, totals, row locks,
account/mode validation, RLS, Stripe settings or payment settlement rules.

The existing READ-only retry classifier additionally recognizes `PGRST003`
without requiring an HTTP status inside the error object. It remains bounded
to two attempts. No Stripe write or booking/refund settlement RPC is blindly
retried; persistent database failures still produce HTTP 500.

## Verification and retest

- Signed-handler tests cover transient pool errors during idempotency and hold
  reads, success on the first delivery, replay without a second confirmation,
  persistent failure, non-retryable financial conflicts and invalid signatures.
- Native PostgreSQL concurrency tests apply the actual migration and check one
  winner/one `PT409`, refreshed snapshots, cancellation conflicts, unchanged
  records after a stale refusal, unchanged grants and repeated migration.
- The full-schema rehearsal applies the new migration before its refund tests.
- After applying ONLY to recovery QA, check that the transaction-context loop
  stops, perform a deliberately stale read-only-before-refusal SQL probe, and
  confirm the recovery release-status endpoint can access its database again.
- BetterQA must run fresh normal-card and 3DS TEST bookings on the current
  recovery preview, inspect delivery history for the recovery destination,
  confirm HTTP 200, exactly one booking and both recipient emails, then verify
  replay/duplicate handling without duplicate bookings or receipts.

The platform still has three TEST webhook destinations, including old QA and
the production-domain TEST destination. Those are not changed by this repair.
A successful recovery delivery cannot establish another destination's success.
Keep BUG-005158 open pending BetterQA's destination-specific acceptance.
