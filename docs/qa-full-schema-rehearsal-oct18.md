# PR #182: QA application-schema rehearsal — October 18, 2026

Draft-only preparation. No merge, active QA promotion, connected database migration, Stripe action or production change.

## Scope and source

Source candidate: `e85117c102e990950be404c2a9d981ea6c80ecd4` on `qa/betterqa-unified-release-candidate-oct18`.
Source schema: ParkShare-QA (`biydlfekindgaslgktsx`), captured using catalog SELECTs inside explicit READ ONLY transactions on October 18. Production was not queried or changed.

The checked-in fixture contains definitions for **all 11 public application tables plus all Auth/Storage tables**: 46 tables, 511 columns, 186 constraints, 163 indexes, 26 non-extension functions, 9 triggers, 18 RLS policies, 10 enums, 8 sequences, role memberships and schema/table/function/column/default privileges. The sole copied configuration row identifies the `listing-photos` bucket and its public/type flags. No QA user, booking, review, message, payment, storage-object or authentication-secret rows were exported. Synthetic `example.invalid` users and financial identifiers are used locally.

This is a catalog-based application-schema reconstruction, not `pg_dump`, a full managed Supabase instance, or a backup/restore certification. Realtime/Vault internals, managed event triggers, extension internals, live Auth/Storage HTTP services, caches, EXIF and actual QA financial data are outside this rehearsal. The application dependency closure uses native btree_gist and uuid-ossp; pgcrypto/Vault/statistics internals are not required by these proposals. Source engine is PostgreSQL 17.11. Local embedded rehearsal uses PostgreSQL 17.5 through PGlite 0.3.14; the dedicated CI job runs native PostgreSQL 17 separately from the existing regression job.

## Read-only QA preflight

- Duplicate `(listing_id,user_id)` review groups: **0**.
- Rates below CAD 1 or with fractional cents: **0**; null rates: **0**.
- Historical addresses without a valid Canadian postal suffix: **8**. Preserve them; new/address-edited rows must comply.
- Source photo bucket is public; draft proposal makes the restored local bucket private.
- QA already contains the baseline registered-checkout columns/table. The nine proposals were applied directly to the captured baseline; baseline migrations were not blindly re-executed.

## Finding reproduced and corrected in the draft

**RC182-TZ-EXCEPTION-TRUST / BUG-005138 integration:** exception validation read Host-editable `availability.timezone`, although BUG-005156 protects `listings.time_zone`.

Using the actual captured policies and an authenticated owning Host, the initial rehearsal set a synthetic property's protected zone to `Pacific/Kiritimati` and submitted exception JSON using `Pacific/Pago_Pago`. At the observed instant, the property-local date was October 19 and the supplied-zone date was October 18. An October 18 exception was accepted despite already being past at the property. This was reproduced locally only.

The draft SQL now reads protected `NEW.time_zone`, requires it to be a valid IANA zone, and requires the JSON zone to match when exception dates are present. Missing trusted zones fail closed for new/edited dated exceptions. Empty exception lists and unchanged legacy availability remain permitted. No timezone is guessed or backfilled. Hosts' workflow for creating dated exceptions before trusted timezone assignment still needs product/release review.

A focused database regression covers mismatched and missing trusted zones. The complete schema rehearsal repeats the adversarial role/date-boundary probe and requires rejection. No application UI or API behavior was changed by this rehearsal repair.

## Verification and recovery coverage

The expanded full-schema rehearsal has **28 checks**, including:

- Restored object counts and captured legacy column grants.
- All nine proposals installed in documented order in one database.
- Synthetic existing paid booking columns and UTC range unchanged; legacy address and CAD 900 rate preserved.
- Postal/whole-cent safeguards, protected timezone assignment, canonical UTC booking, past exception rejection.
- Anonymous, owning Host, unrelated Driver, paid Driver and service-role permissions.
- Private bucket metadata and Storage object RLS isolation. This is SQL-level coverage, not Storage HTTP authorization certification.
- Actual QA booking trigger/constraints with service-role extension reserve/apply; wrong connected account rejected; hours/audit/hold updated atomically; repeated apply adds no duplicate extension.
- Active unpaid hold quota rejection and account-deletion financial FK restrictions.
- Injected duplicate review collision: proposal 7 fails with SQLSTATE 23505; its policy/grant changes roll back; proposals 8-9 have not run. After correcting synthetic data, only proposals 7-9 resume successfully.
- Blind reapplication of proposal 3 fails with SQLSTATE 42710 and rolls back without altering booking data. These proposals are not universally idempotent. Final migrations require version tracking and a verified committed-stage inventory; never rerun the entire sequence blindly.

Each proposal owns its transaction. Failure of proposal 7 does **not** reverse already committed proposals 1-6. Recovery demonstrated here is controlled forward resumption on synthetic data, not reversal of every prior stage and not a live backup restore test.

## Reproduce on disposable native PostgreSQL 17

Use a NEW local PostgreSQL 17 service with database `parkshare_test`. The runner drops and recreates public/auth/storage/extensions. Never connect a database tunnel or hosted QA/production instance.

```sh
npm ci
QA_SCHEMA_REHEARSAL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/parkshare_test node scripts/run-qa-schema-rehearsal.mjs
```

The runner validates the local hostname, dedicated database name and absence of URL options before connecting, then verifies the actual database and PostgreSQL major version. The dedicated GitHub Actions job provisions an isolated PostgreSQL 17 service and uploads `qa-schema-rehearsal-results.json` as evidence. The default `DATABASE_URL` and `TEST_DATABASE_URL` are not consumed by this runner.

## Gates still open

- Real Stripe TEST connected-account signed webhook/first-delivery/retry/refund/dispute exercises and concurrent browser/API flows.
- Actual private Storage HTTP/signed URL and historical image-link/cache/EXIF checks.
- Trusted per-listing IANA timezone assignment and explicit review of historical paid future reservations.
- Owner decisions on quotas, extension accounting, partial refunds, public privacy and account closure/retention.
- Final numbered migrations and reviewed version/backup/recovery procedure.
- Tudor's coordinated QA window, exact candidate SHA and BetterQA retest/sign-off.

Passing this rehearsal is not deployment approval. BetterQA's active server and production remain unchanged.
