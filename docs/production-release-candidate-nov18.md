# Combined production release candidate — November 18, 2026

Preparation and isolated testing only. This draft is not a production release
approval. No hosted schema, application alias, scheduler, financial object or
transactional email was changed to prepare it.

## Release composition

| Component | Immutable source | Acceptance |
| --- | --- | --- |
| Frozen SOW 1 QA | `072629e16b35970bcae1260ab2e5660ece2b08d8` | BetterQA regression and report |
| Combined booking/refund repairs, PR #254 (includes PR #257) | `e713f6032e9415ff6fbb3dc20449a96a5fa4fc18` | Five fixes and Vancouver cancellation checks accepted by Brad |
| Clock-change repair, PR #259 | `6cc39fc644161dbc8234ef12d6e51a6951d47705` | Automated tests and signed-out browser checks passed; independent paid-flow retest pending |
| Durable payment alerts, PR #256 | `d5a2791829622121e08310c85561b1a848918fcd` | Earlier isolated tests; deployed path and production activation pending |
| Production migration preparation, PR #253 | `6d60760ea0da490d90f1893faf295071ea07809b` | Earlier synthetic migration rehearsal; refreshed here |

Runtime integration source: `1e959342d56c5b15118e73edd51d3d14ea3691fa`.
This commit combines the sources above. Later package-only commits update the
manifest, catalog fixture, rehearsal, evidence and documentation. The PR's final
head and its checks identify the exact combined candidate to review; the private
database marker's `source_commit` identifies the immutable runtime integration.
Do not merge the component PRs a second time as additional release changes.

## Matching database package

The existing, never-applied production candidate migration is regenerated in
`deployment/production-database/supabase/migrations/20261111125931_production_release_candidate.sql`.
Its original CLI-created filename is retained; this is a revision of the same
unapplied draft, not a new hosted migration or a replay of the QA migration history.

The package has **32 reviewed SQL inputs**, including the alert outbox previously
missing from PR #253. The manifest binds the source hashes, combined application
source, refreshed production fixture and generated SQL hash. A single transaction
preserves every original public-table column/value and row count. New financial,
notification, photo-cleanup and alert queues must all start empty. Service-only
alert functions remain `SECURITY INVOKER`, with browser access revoked and RLS on.

Only the production package directory is a future deployment input. Never run
the QA `supabase/migrations` directory against production. No hosted execution
runner or automatic migration-on-merge workflow is supplied.

## Refreshed production evidence

Metadata and aggregate queries were run around **21:58–22:03 EST November 18**
(02:58–03:03 UTC November 19), against `oyxrussraxjgqwzpwyca` only.

- Production application remains `8c80fea`; database reports PostgreSQL 17.6,
  provider release 17.6.1.155. Application catalog fingerprint remains
  `c88a7b09cb3c4da5b99628cfe6d6a3a6`.
- The fresh catalog includes two new managed Storage tables, 20 additional
  Auth/Storage columns, six additional constraints and associated managed code
  and grants. These are incorporated in `production-schema-nov18.json`; the
  November 11 fixture and its historical evidence remain available.
- Current aggregates: 29 paid bookings, two extensions, 13 listings and 15 Auth
  users. No customer, authentication credential or Storage-object rows were
  exported. Local/CI rehearsals seed synthetic records only.
- No active Checkout hold was observed. One retained Checkout reference still
  requires Stripe terminal-outcome reconciliation before cutover.
- Three listings still have invalid/missing coordinates; one listing owner
  lacks the Host role. Review through authorized owner/operator flows.
- Production has no trusted property timezone column yet. The migration adds
  it as NULL. A separately reviewed resolver/backfill must establish legitimate
  listing zones before scheduled booking is enabled. Do not guess zones or
  rewrite/reprice historical paid bookings.

### Confirmed database timezone prerequisite

The actual production query for Vancouver **November 18, 2026 at 10:00** returns
**18:00 UTC**; current rules require **17:00 UTC**. Toronto's March 2027 1–4 AM
conversion correctly spans two elapsed hours. This is a database timezone-data
issue separate from BUG-005674's withdrawn QA finding and the application
clock-change repair in BUG-005823.

Before production approval, arrange the supported Supabase Postgres/tzdata
upgrade, review its extension/index prerequisites and downtime, then rerun
`release-preflight-readonly.sql`, recapture the managed catalog and repeat the
rehearsal if definitions changed. Supabase's advisory identifies 17.11.0.003 or
later as corrected. No database upgrade is performed by this PR.

- [Timezone advisory](https://supabase.com/changelog/tzdata-local-time-vancouver-edmonton-casablanca)
- [Upgrade compatibility checks](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)

## Backup and recovery evidence

The dashboard currently lists seven completed daily physical backups, newest
**November 18 at 13:03:02 UTC / 08:03:02 EST**. PITR remains disabled.
The saved November 12 managed-restore report records a successful separate-project
restore and 13 passing comparison groups; the temporary rehearsal was subsequently
deleted. This is existing restore evidence, not a new restore performed here.
Managed database backups do not cover uploaded Storage files or external service
configuration. Recheck a suitable recovery checkpoint immediately before cutover.

## Validation and limits

Use the exact PR-head checks as the current result:

1. Full regression tests with a disposable database, followed by the app build.
2. Full QA-schema rehearsal, including the alert outbox.
3. Production-catalog migration rehearsal on isolated PostgreSQL 17.6 and 17.11:
   fingerprint/hash checks, drift and rollback failures, historical preservation,
   empty queues, RLS/permissions, refund and reminder behavior, alert access,
   immutable enqueueing, concurrent leases, backoff, retry cap and acceptance.
4. Signed application / real local database API / simulated email alert flow.

The alert probe uses the schema installed by the combined migration; it does not
install a second copy after the package. CI has no hosted database, Stripe or
Resend credentials. These checks do not certify managed Auth/Storage HTTP flows,
live Stripe, production email delivery, deployed alert configuration or Host payout.
Historical evidence files under `deployment/production-database/evidence` retain
their original source pins; they are not passes for this candidate.

## Cutover gates and activation order

1. Complete BetterQA's clock-change retest and review this exact combined head.
2. Resolve the timezone prerequisite and refresh/rehearse any changed catalog.
3. Reconcile the retained Checkout reference and review listing locations,
   ownership and trusted zones. Verify Live/TEST credentials, separate webhook
   signing secrets, production sender/APP_URL and Maps restrictions.
4. Complete at least one real Host's Connect onboarding and verify charge/payout
   eligibility, schedule and fee/dispute responsibilities.
5. Verify a current recovery checkpoint and controls to pause new checkouts and
   every production worker while preserving Stripe's retryable event handling.
6. Under Brian's production approval, apply the reviewed transaction and deploy
   its matching application as a coordinated cutover. Run read-only postflight
   plus agreed hosted Auth, Storage, listing and authorization checks.
7. Audit queues and enable one scheduler per approved worker. The inherited
   `vercel.json` declares reminder/refund/photo-cleanup cron entries: do not
   promote until their hold/activation is explicitly controlled. Keep photo
   cleanup disabled until its object scope is approved. Do not add a second
   Supabase scheduler for the same worker.
8. Alerts default off. Verify the approved recipient/sender/environment, enable
   the deployed alert path and test it under its agreed scope; register only one
   alert scheduler. Its worker sends email only and never moves money.
9. Verify at least 20 successful minute runs, actual inbox delivery and agreed
   controlled live booking/refund/Host-earnings checks before a broader launch.

The partial-refund-with-paid-extension case (TC-064 step 6) remains coverage not
run. The two stale-refund-snapshot retry/logging improvements remain agreed
post-launch work outside SOW 1 and are not implemented by this integration.

If cutover fails after new financial activity, preserve the new ledgers and pause
workers/checkouts. Use a reviewed forward repair or schema-compatible rollback;
do not restore an older database over new payments. The old reminder worker is
not an approved fallback because it includes Host CC.
