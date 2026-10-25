# Production readiness preparation — 25 October 2026

Status: preparation branch only; production release remains **HOLD**. This work
does not change the QA build/database or the production build/database.

## Completed preparation

Three repository migration filenames and every executable/documentation reference
now use their already-applied QA versions. Their SQL bytes are unchanged. Read-only
QA history verification returned these exact MD5 values:

| Previous filename timestamp | Applied QA timestamp | Migration | SQL MD5 |
| --- | --- | --- | --- |
| 20261020205407 | 20261021040753 | extension_settlement_005116_005260 | 6ec18af5e71c0039488fb68b47d74030 |
| 20261021103527 | 20261021104409 | booking_reminder_delivery_005226_005261 | 64575c66816e40fa8732073a2297c94d |
| 20261021111213 | 20261021112637 | refund_notifications_005249 | 3a5d0fd75e29bbfb5d12170fe77c69e5 |

No remote migration history repair or SQL replay is needed for these three
renames. QA has **24** applied migration records, including the earlier bootstrap
records outside `supabase/migrations`; this is not a complete fresh-project
migration chain. Correct the earlier audit's count of 25 to 24.

Production has no `supabase_migrations.schema_migrations` relation. Do not mark
all QA migrations applied or run `db push` against it. The two Oct 19 QA-specific
migrations create QA backup/geography artifacts and are excluded from the
production-shaped experiment.

## Production-shaped rehearsal

`test/database/fixtures/production-schema-oct25.json` captures only catalog
definitions, policies, role flags/memberships, grants and relevant bucket
configuration from production at 2026-10-25T21:37:38Z. It contains no application
rows, auth accounts, passwords, sessions, object names or keys. Auth and Storage
schema definitions are present to restore actual foreign keys/triggers/RLS
dependencies, rather than mocking an incomplete application schema.

The runner verifies the local URL, database name and PostgreSQL 17 engine before
resetting schemas. It uses only `PRODUCTION_SCHEMA_REHEARSAL_DATABASE_URL`, requires
localhost/127.0.0.1/::1 and `/parkshare_test`, rejects connection options and never
uses ordinary `DATABASE_URL` or `TEST_DATABASE_URL`. Use a NEW isolated service;
do not forward a hosted database through localhost. It restores this catalog,
adds synthetic records, and exercises:

- Production's ten application tables, missing checkout registration and photo
  bucket, and four original cascading financial foreign keys.
- Existing prerequisites 010–013, then the ten reviewed core SQL proposals.
- Historical paid-field preservation, real RLS/column grants, private photos,
  account-deletion retention, extension settlement/replay and unpaid hold quotas.
- Deliberate duplicate-review migration failure and controlled forward resumption.
- Photo cleanup, refund ledger, bounded discovery, trusted timezone assignment,
  publication retries, extension rejection/refunds, reminder queue installation,
  refund notification isolation, 12-month horizon installation, initial booking
  settlement and extension bay-capacity patch.
- Final private photo metadata, anonymous listing access, four RESTRICT financial
  keys, queue presence and absence of the QA backup schema.

The repeated prerequisite trace reflects the deliberate fresh restore for fault
injection. It is not permission to replay committed migrations in a live database.
The existing QA rehearsal remains independent and runs in a separate CI service.

```sh
npm ci
PRODUCTION_SCHEMA_REHEARSAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/parkshare_test node scripts/run-production-schema-rehearsal.mjs
```

The dedicated GitHub Actions workflow uploads
`production-schema-rehearsal-results.json` with the exact commit, baseline capture
time, fixture SHA-256, passed checks and any failure. The experiment is **not** a
versioned production migration bundle, live rollback/backup restore exercise,
Storage HTTP verification, Auth configuration test or real Stripe/email test.
New production migrations still require review and CLI-generated versions after
the final baseline, order and maintenance window are agreed.

## Read-only production preflight

At this preparation snapshot: 13 listings, 28 bookings, 1 review; zero duplicate
review groups, zero unexpired holds and zero active/future paid confirmed
bookings. Three listings lack usable coordinates and seven use inline cover
images. These are time-sensitive counts, not a future maintenance-window gate.
No customer rows were exported. Recheck immediately before an approved rollout.
Resolve coordinates from verified property information; do not guess zones or
rewrite historical paid times, totals or financial identifiers.

## Work Brian can complete during the QA wait

| Decision/action | Concrete result needed | Proposed coordination |
| --- | --- | --- |
| QA service incident | Supabase response, then readiness/search/sign-in/profile recovery evidence | Brian follows existing support case; engineering verifies recovery |
| Password policy, BUG-005322 | Choose an enforceable server-side strength/breach protection approach; current browser checks alone do not close it | Brian + engineering; any paid plan change needs separate approval |
| Written reviews, BUG-005325 | Confirm acceptance of paid-Driver/Host-only text, or specify public pre-booking moderation/redaction requirements | Brian + BetterQA |
| Support readiness | Confirm monitored inbound mailbox, primary/backup owner and escalation contact | Brian; see launch-support-operations-checklist.md |
| Listing readiness | Verify the three missing-coordinate properties and plan safe handling of legacy inline images | Brian + authorized data operator; no silent bulk rewrite |
| Backup/recovery | Identify verified database backup/restore owner and separate Auth/Storage recovery coverage | Brian + platform operator |
| Release ownership | Agree one migration operator, production window, abort thresholds, monitoring owner and rollback decision-maker | Brian + engineering + BetterQA |

Suggested owners are coordination proposals, not confirmed assignments. Do not
send test messages or perform live payments solely from this checklist.

## Ordered gates before any production change

1. Recover QA and verify readiness, parking discovery, sign-in and profile load.
2. BetterQA completes pending retests and payments regression against an agreed
   frozen commit; record exceptions/blockers and obtain the launch-readiness report.
3. Agree password/review scope decisions, review this preparation PR and pass both
   catalog rehearsals plus the complete PostgreSQL-backed regression suite.
4. Refresh production catalog/preflight; produce a production-specific versioned
   migration bundle and explicit history baseline. Do not blindly replay the QA
   release or mark its history applied. Rehearse that exact final bundle.
5. Confirm verified backups/recovery, financial reconciliation procedure, live
   configuration, Auth/Storage/Stripe/email checks and the maintenance window.
6. Obtain explicit production rollout approval. Rebuild the reviewed source in the
   actual production project with production settings; validate before public
   promotion. Database recovery needs its own plan, separate from Vercel rollback.

BetterQA dates may move while QA is unavailable; reconfirm the testing schedule
after recovery. Passing this branch's SQL rehearsal does not establish end-to-end
release acceptance or restore the hosted QA service.

References: Supabase's current [migration workflow and history diagnosis](https://supabase.com/docs/guides/deployment/database-migrations).
