# Production timezone upgrade preparation — November 19, 2026

**Prepared, not executed.** The provider confirmation was inspected, but Confirm
upgrade was not submitted. Production remains database build 17.6.1.155 and
application `8c80fea`; PR #260 remains draft and unmerged.

## Reviewed operation

| Field | Verified value |
| --- | --- |
| Project | ParkShare, `oyxrussraxjgqwzpwyca`, us-west-2 |
| Current database | Supabase 17.6.1.155 / PostgreSQL 17.6 |
| Only offered target | **17.12.0.000** |
| Method | Managed in-place Upgrade project, General settings / Service versions |
| Provider warning | All services offline for up to **one hour** |
| Downgrade | No downgrade to 17.6.1.155 after success |
| Disk | Current 2 GB is right-sized by the provider during upgrade |
| Other observed versions | Auth 2.198.0; PostgREST 14.15 |

The offered target supersedes the earlier 17.11-only preparation. CI now includes
PostgreSQL 17.6, 17.11 and **17.12**. These are generic isolated PostgreSQL
rehearsals, not a completed managed Supabase in-place upgrade or certification of
the provider's bundled extensions. No compute resize, extension drop, credential
reset, new add-on or subscription change is part of this preparation.

## Compatibility review at 05:05–05:09 EST / 10:05–10:09 UTC

The production catalog and read-only probes found:

- No ltree, GiST float, unbounded bpchar, gist_trgm_ops or GIN index review matches;
  no invalid/unready indexes. Do not perform blanket REINDEX operations.
- No custom operators with non-built-in estimators, non-extension C functions or
  stored regtype columns in the checked schemas.
- No replication slots, subscriptions, foreign servers, prepared transactions or
  pg_cron installation. Inventory external schedulers separately.
- No MD5 login roles returned. No password or password hash was exported or changed.
- Vault is installed but contains zero secrets. No application PGP/cipher references
  were found in public functions or checked repository directories. No private
  ciphertext was scanned for the cipher advisory.
- Installed extensions: btree_gist, pg_stat_statements, pgcrypto, plpgsql,
  supabase_vault and uuid-ossp. The unsupported plv8/TimescaleDB families are absent.
- No active Checkout holds or future confirmed bookings. **One retained Checkout
  reference needs Stripe terminal-outcome reconciliation before maintenance.**
- Health advisors returned no notices. Existing security notices cover legacy RLS
  without policies, a mutable function search path, btree_gist's schema and Auth
  leaked-password protection. This engine operation does not close those items.

The captured database size is approximately 17.95 MB. That does not establish a
downtime promise; retain the provider's one-hour planning allowance.

Production converts Vancouver November 18 at 10:00 to **18:00 UTC**, while the
current rule requires **17:00 UTC**. Supabase's advisory identifies 17.11.0.003 or
later as corrected. Require the actual upgraded project to pass the verification
queries rather than inferring success from its version number.

The review includes the 17.11 compatibility guidance and 17.12 index repair notes.
No matching index categories were found and no index repair was performed. The
provider owns its packaged C extensions; investigate any provider precheck warning
before confirmation instead of dropping or rebuilding extensions automatically.

## Recovery and comparison scope

The dashboard still lists seven daily physical backups, newest **November 18 at
13:03:02 UTC / 08:03:02 EST**. PITR remains off. The saved November 12 managed
restore passed 13 comparison groups; its temporary project was later deleted.
That is existing restore evidence, not a new managed rehearsal for 17.12.

Before execution, select a sufficiently recent recovery checkpoint and review
the gap between that snapshot and the stopped-write baseline. The currently
visible daily snapshot is not a zero-data-loss checkpoint. Do not enable PITR or
create a paid recovery clone without its own authorization. Database backups
exclude uploaded Storage files and external service configuration. Current Storage
metadata counts are zero buckets and zero objects.

The count-only preservation query captures all 10 existing public tables, seven
sequence positions, Auth/identity counts and Storage counts. Planning baseline:
29 bookings, two extensions, 13 listings, 15 profiles, 15 Auth users/identities
and nine messages. Recapture after writes are quiesced, then compare immediately
after the engine operation, before any application/schema release or user traffic.

Automatic review rejected a full-row-digest request because it would export
derived private production data; that request did not run. The replacement uses
schema, counts and sequence positions only. Equal counts do not prove every
stored field unchanged. No private-row equality audit is claimed by this plan.

## Execution sequence — approved maintenance window required

1. Obtain Brian's approval for the production operation and a window allowing up
   to one hour offline. Recheck target, warnings and recovery point. No calendar
   time is scheduled and no upgrade has started.
2. Reconcile the retained Stripe Checkout reference. Inventory schedulers and
   in-flight writers. Pause new checkouts and production workers, drain requests
   and preserve retryable failed webhooks for Stripe. Empty hold counts alone are
   not a traffic freeze. Verify the maintenance control and its reversal before
   applying it; keep webhook signature verification enabled.
3. After writes stop, recapture preflight, catalog/fingerprint and counts/sequences,
   and record the recovery point. Stop for new holds, replication dependencies or
   provider precheck warnings. Planning snapshots are not the stopped-write baseline.
4. Verify the exact ParkShare project and **17.12.0.000**, then submit Confirm
   upgrade once under the approved scope. Monitor provider status; a spinner or
   timeout is not permission to start another operation.
5. Wait for ACTIVE_HEALTHY. Check service versions/advisors, compare the paused
   schema/count/sequence baseline, and verify agreed Auth, PostgREST, existing
   listing reads and Storage access. No financial test, webhook replay or real
   transactional email is authorized by this preparation.
6. Run every case in `timezone-upgrade-verification-readonly.sql`: Vancouver winter
   and spring; Toronto either side of spring and 2/4-hour spring/autumn spans;
   Regina, Edmonton, Winnipeg and Inuvik. All required cases must pass on the
   actual upgraded provider. Do not rewrite old booking intervals to make tests pass.
7. Recapture the managed catalog. Refresh PR #260's fixture/manifest and repeat
   its migration rehearsal if definitions changed. Generic CI does not replace
   this actual hosted capture.
8. Resume only the previously approved service scope after verification, then
   monitor errors and Stripe retries. Broader launch remains behind its other
   release gates. Obtain and verify a new full recovery checkpoint after success,
   following the provider's backup guidance.

## Failure handling

Before confirmation, Cancel leaves the database unchanged. On a failed upgrade,
Supabase documents an attempt to bring the original database online; verify that
outcome. After success, the dashboard offers no downgrade. Keep maintenance in
place if verification fails and use the existing Supabase support route for an
assisted recovery or forward repair. Do not restore an older snapshot over newer
payments or Auth changes. Any restore, deletion or new paid recovery project needs
its own reviewed scope. An app rollback neither downgrades the DB nor reverses
financial provider actions.

## Files and evidence

- `deployment/production-database/timezone-upgrade-preflight-readonly.sql`
- `deployment/production-database/timezone-upgrade-preservation-readonly.sql`
- `deployment/production-database/timezone-upgrade-verification-readonly.sql`
- `deployment/production-database/evidence/timezone-upgrade-preparation-nov19.json`
- PR #260: exact-head checks and three-version migration rehearsals.

## Primary references

- [Supabase managed upgrades](https://supabase.com/docs/guides/platform/upgrading)
- [Supabase timezone advisory](https://supabase.com/changelog/tzdata-local-time-vancouver-edmonton-casablanca)
- [Supabase 17.11 compatibility guidance](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)
- [PostgreSQL 17.12 migration notes](https://www.postgresql.org/docs/17/release-17-12.html)
