# Production database migration candidate — November 11, 2026

Prepared for Brian Becker and BetterQA. Powered by ESKA Technologies.

**Preparation and isolated rehearsal only. This is not production deployment approval.**
No production or recovery-QA database, deployment, scheduler, Stripe object, email or stored image was changed by this work. The SQL creates database objects and private bucket metadata only when later executed in an approved environment; it contains no external provider calls or scheduler activation.

## Result

Frozen-source refresh: this package now binds the November 15 handoff's app commit **072629e16b35970bcae1260ab2e5660ece2b08d8**, including BUG-005661. Production's complete scoped application/Auth/Storage catalog was recaptured at **03:08 UTC on November 12 / 22:08 EST on November 11**. All five catalog sections match the prior capture apart from capture time, including ordered enum labels and permissions. The 31 SQL inputs are unchanged; the generated SQL differs only in the private release marker's app-source commit. The new SQL SHA-256 is `5ae2c33139f15ea8da10cabdd6a466e3460cd8ee4f4b40c8bd331d0b5b0e5f67`. See `evidence/frozen-source-refresh.json`. Production and active QA were not modified.

The package was rehearsed on native PostgreSQL **17.6**, matching production's major/minor engine. It restores production's captured application, Auth and Storage *definitions*, then uses synthetic users, bookings and messages. No production customer, authentication, payment or Storage-object rows were copied.

- **74 production migration checks passed**, including actual competing database connections for job claims and the private marker's frozen source/input hashes.
- **144 existing QA schema checks passed**, after preserving the QA probes' default install behaviour.
- **84 focused cancellation, financial retry, authenticated-handler and target-guard tests passed**. Provider responses in these unit tests are mocks; no payment or email was sent.
- **1,935 full regression tests passed locally with no failures/skips; application build passed.** The new GitHub checks are tracked separately on the refreshed PR head and are not inferred from earlier CI. Current local results and verification time are in `evidence/frozen-source-refresh.json`; earlier evidence files retain their historical source pins.
- All 31 source SQL components install in one transaction. Failure of a late unique-index check rolls back all earlier schema and bucket changes. An injected historical-field change is also detected and rolled back.
- All original columns/rows in the synthetic legacy application tables survive. This includes 29 paid bookings, two extensions, sent-reminder markers, a legacy partial refund, seven messages without recipients and a retained expired Checkout hold.

`evidence/rehearsal-results.json` binds the successful test to the generated SQL SHA-256 and source commit. The production catalog fixture contains 45 tables, 499 columns, 178 constraints and 19 policies across public/Auth/Storage. The application catalog fingerprint reproduced locally matches the read-only production fingerprint. This is a catalog reconstruction, **not a full managed-Supabase clone or proof of backup restoration**.

## Package boundary

- Frozen QA app source: `072629e16b35970bcae1260ab2e5660ece2b08d8`. Production release approval remains separate.
- Observed production app: `8c80feab4596e238eb46f585de5b8e1f2cf4b433`.
- Intended production database: `oyxrussraxjgqwzpwyca`.
- `manifest.json`: ordered original sources, original file SHA-256s, adaptation notes, generated migration SHA-256, baseline fingerprint and fixture hash.
- `supabase/migrations/`: the **separate production-package** migration directory. The filename was created with Supabase CLI 3.0.0 `migration new` in this workdir.
- `schema-fingerprint.sql`: read-only fingerprint of application definitions and permissions; ACL order is canonicalized to avoid false drift reports.
- `capture-catalog-readonly.sql`: reproducible metadata/count capture, with bigint sequence limits serialized losslessly as text.
- `postflight-readonly.sql`: internal aggregate schema/permission checks after a later approved deployment. Do not publish its output as an anonymous endpoint.

The builder ports the prerequisite registered-Checkout schema, financial retention FKs, Host/Storage policies, ten integrated repairs, later refund/extension/publication/reminder fixes, cancellation-fee operations and future-only chat email queues. It deliberately excludes QA recovery backups, geography-cell assignments, Vault/pg_cron/pg_net bootstrap, account data and historical mail/refund backfills. The photo bucket is private from creation; no image objects are copied or deleted.

## Controls and preservation

1. Without an explicit migration scope, the SQL refuses before creating anything. The runner accepts only a loopback URL, a dedicated disposable database name, no URL override options and PostgreSQL 17. The actual server must be loopback, or the explicitly configured GitHub Actions disposable Docker bridge. On entry it requires zero application/Auth/Storage tables before any restore. Never use a tunnel or port-forward to a hosted database.
2. Before schema changes, acquire the migration advisory lock and bounded table locks. Recheck the captured application fingerprint and Storage baseline. A changed baseline requires recapture, review and a new rehearsal.
3. Active Checkout holds block cutover. Retained Checkout evidence requires a documented Stripe reconciliation and explicit operator acknowledgement; an expired hold alone is not proof its payment is terminal.
4. Capture internal digests and the original column list for **every existing public table**. Recheck row counts and every original value before commit, including session ranges, amounts, legacy refund fields and notification timestamps. New audit/default columns are the only excluded fields. Digests stay inside the database; no private rows are logged or exported.
5. Require all new money, refund, email, reminder and photo-deletion queues to be empty at commit. No historical messages are enqueued and settled historical refund discovery is suppressed by the rollout marker.
6. Browser roles cannot read/write money and delivery tables or execute financial RPCs. Native tests cover profile/message RLS, forged property location changes, FK retention, canonical booking instants, Storage owner boundaries and separate refund audiences.
7. A private release-version row records the source commit and inputs hash in the same transaction. Reapplication is refused; do not bypass this by deleting the marker or altering migration history.

The production mode additionally requires explicit project, backup/restore and checkout/worker-pause acknowledgements. Those flags are operator assertions, **not independent proof** of the host, backup or scheduler state. Verify the connection target and real evidence externally. No hosted execution runner or automated production workflow is supplied.

## Reproduce on a new local PostgreSQL 17.6 service

Create an empty local database called `parkshare_production_rehearsal`, with the btree_gist and uuid-ossp extension binaries available. Install locked repository dependencies, then run:

```sh
npm ci
node scripts/build-production-migration.mjs
PRODUCTION_SCHEMA_REHEARSAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/parkshare_production_rehearsal node scripts/run-production-schema-rehearsal.mjs
```

The runner deliberately drops and recreates application/Auth/Storage schemas **only inside that isolated local database**. It also exercises rollback and reinitializes the synthetic fixture between failure scenarios. It never reads `DATABASE_URL` or the default production credentials.

The dedicated GitHub Actions workflow provisions its own PostgreSQL 17.6 service without Supabase, Stripe, Resend or Vercel credentials. It rebuilds the package, requires zero generated SQL/manifest diff, runs the rehearsal and preserves the results as a workflow artifact.

## Production findings to resolve before cutover

These counts are read-only observations from November 11 and must be refreshed before release; they are not customer corrections made by this package.

| Finding | Required handling |
| --- | --- |
| 29 paid booking records; two extensions; no confirmed future reservations at capture | Preserve financial history regardless of whether an older payment was live or TEST. Recheck immediately before cutover. |
| One retained expired Checkout session/hold | Reconcile its terminal Stripe outcome and any delayed delivery before acknowledgement. Keep its evidence; do not purge it to satisfy the guard. |
| Three listings lack valid coordinates | Verify the intended locations through the normal authorized Host/operator flow. Do not invent coordinates or apply QA geography to production. |
| Existing listings have no trusted `time_zone` column yet | This schema migration adds it as NULL and does not guess a zone. Prepare a separately reviewed per-listing resolver/backfill before enabling the new booking flow; missing zones can block dated availability and scheduled Checkout. Never rewrite historical paid booking intervals. |
| One listing's owner profile is a Driver | Review the legitimate owner/Host setup. Do not promote the profile or reassign the listing automatically. The new Host policies intentionally refuse ordinary Driver management. |
| Seven historical messages have no recipient | Preserve them. Do not guess recipients or enqueue old chat mail. Sender visibility follows the approved participant rules. |
| Storage has no buckets/objects copied; legacy listing images include embedded data and other formats | Provision the private bucket metadata as reviewed, then verify actual upload, signed/private image serving and legacy image compatibility. Keep photo-cleanup scheduling disabled until its object/deletion scope is approved. |
| No production migration history was returned | Do not replay the QA directory or mark its 30 history entries applied. Review a separate production baseline/history adoption procedure. The package has its own private release record; CLI history is still a separate operational step. |

## Remaining launch gates

The old production app is incompatible with parts of the privacy and new server-write boundary. This is a coordinated application/database cutover, not a schema-only hot deployment.

- A fresh managed backup/PITR checkpoint and **an isolated restore test** with recorded date/result. This rehearsal does not close that requirement.
- A reviewed production release PR/commit integrating the QA code; the preparation branch and PR #252 are not a production promotion.
- Verified live keys, signing-secret isolation, sender identity, scheduler authentication and alert route. Connected-account webhook scope is now confirmed read-only by the live destination's `events_from: ["@accounts"]` setting; see `evidence/live-connected-event-scope.json`. No key values belong in evidence.
- Verified controls to pause production workers and new checkouts while preserving retryable Stripe event handling. `--skip-domain` alone is not proof of a scheduler hold.
- BetterQA acceptance of staff-only reason restrictions, forged direct requests, partial refunds, TEST-mode fee credits and the Nov 15 frozen build; Nov 16–17 regression; Nov 17 report.
- Actual hosted Auth/PostgREST/Storage HTTP tests and explicitly approved live payment/refund/email scenarios after deployment. Database-level permission tests and mocked providers do not prove these outcomes.
- Queue inventory, activation of one scheduler per production worker, at least 20 consecutive successful minute runs, and actual controlled inbox evidence. The refund worker can move money, not merely send email.
- Postgres/tzdata version review: production reports 17.6. Check current Supabase upgrade/tzdata guidance for the supported Canadian property zones before rollout. This rehearsal does not upgrade the production server; an earlier version-specific advisory is not being treated as a fresh finding.

## Failure and recovery

Before the transaction commits, issue ROLLBACK and diagnose the failed condition. The tests demonstrate full rollback after a late uniqueness failure and a preservation-check failure. No source stage is independently committed.

After commit, preserve the new financial/delivery ledgers. Pause workers and new checkout/refund actions first if an incident occurs. Prefer a reviewed forward repair or a rehearsed schema-compatible application rollback. **Do not blindly restore a pre-release database over new payments.** The old production worker includes Host CC and is not an approved fallback. Restoring an app build cannot reverse a refund, transfer or delivered email.

Brian owns the production go/no-go. BetterQA owns QA acceptance and the readiness report using supplied production evidence. Keep the frozen QA build unchanged during November 16–17.

## Primary references

- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase database testing](https://supabase.com/docs/guides/local-development/testing/overview)
- [Supabase CLI v3 changes](https://supabase.com/changelog/supabase-cli-v3)
- [Supabase time-zone data advisory](https://supabase.com/changelog/tzdata-local-time-vancouver-edmonton-casablanca)
