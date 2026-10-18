# ParkShare / BetterQA — Unified QA Release Gate & Deployment Runbook
**October 18, 2026 — DRAFT REVIEW ONLY. Not approved for deployment.**

## Release identity and verified checkpoint
- GitHub draft PR #182: https://github.com/brianbecker1929-cyber/ParkShare/pull/182
- Exact tested commit: 2775342cac6c7b82deaba0317905183520145812
- GitHub Actions run 39136411354: **435/435 tests PASS, 0 FAIL, 0 SKIPPED**, Vite build PASS.
- Both parkshare-qa and parkshare-project Vercel **preview** checks PASSED, not alias promotions or production deployment.
- Added test/database/qa-unified-sql-rehearsal-oct18.test.js: all nine draft SQL proposals install in sequence in a LOCAL disposable PostgreSQL schema, with six assertions covering compatibility, permissions, historical paid intervals, data validation, new timezone UTC, and financial FKs.
- **Important limit:** This uses a production-shaped SUBSET of the QA schema, not a full actual QA schema/database clone. It is not a complete schema-upgrade certification.
- Read-only QA deployment check: parkshare-qa.vercel.app was still serving October 16 base commit 42f27f85a18bf1c730b5d5d200b4ee8fdd3ec7e6, deploy dpl_2By14QGJDgxfYcoxzNsYEMVfqPeG. Verify again before cutover.
- Target QA Supabase project ParkShare-QA: biydlfekindgaslgktsx; production is a DIFFERENT project: oyxrussraxjgqwzpwyca. No new schema proposals have been applied.

## Order successfully rehearsed on the scratch schema (NOT deployment approval)
All nine are drafts inside docs/sql-proposals; do not directly apply to actual QA.
1. bug-005118-unpaid-hold-rate-limits.sql — Driver hold quota and ordered locks, depends on existing registered Checkout snapshot procedure. Proposed thresholds **2 active / 4 per 2h / 12 per 24h** require owner approval and extension-accounting decision.
2. qa-atomic-extensions-and-refunds.sql — held extension tail, linked pending hold, audit columns, atomic apply RPC. Requires paid extension and pending extension base tables.
3. bug-005156-property-local-canonical-bookings.sql — verified property IANA time zones and UTC intervals; preserve historical paid booking instants. Missing trusted zone blocks new scheduled Checkout only.
4. bug-005136-listing-postal-validation.sql — new address edit safeguard, preserve historical addresses.
5. bug-005137-hourly-price-constraint.sql — positive whole-cent rate, NOT VALID until separate historical-data audit.
6. bug-005138-future-exceptions.sql — listing exception validation, depends on trustworthy property time zones.
7. qa-verified-reviews.sql — verified API-only new reviews and unique listing/Driver pair; scan duplicates before unique index.
8. bug-005183-restrict-public-data-api.sql — private direct listing/profile/review data and private photo bucket; coordinated secure API/frontend + Storage policy rollout required.
9. qa-account-deletion-booking-retention.sql — RESTRICT destructive account FKs to protect financial history; requires approved compliant account-closure process.

Existing underlying schema prerequisites include supabase-migration-005-booking-holds.sql, supabase-migration-010-preserve-bookings-on-listing-delete.sql and supabase-migration-011-registered-checkouts.sql. Do not reapply blindly if QA baseline records them under different version names.

## Required gates before any active QA change
- [x] Combined source, six integrated disposable SQL assertions, 435 automated tests and preview builds passed on exact candidate SHA.
- [ ] ParkShare owner approve rate-limits/extension counting; multi-partial-refund ledger handling; anonymous listings/photos/reviews policy; account closure/retention policy.
- [ ] Read-only inventory current QA schema and migration versions, historical payments/holds, policies, triggers, private photo Storage policies, existing review duplicates and rate/exception outliers.
- [ ] Obtain SANITIZED full QA-schema equivalent in disposable environment and rehearse the entire ordered migration set, including data collisions, idempotence, role authorization and recovery. Capture full test evidence.
- [ ] Resolve per-listing verified IANA time zones. Do not guess Toronto for all Canadian properties or use browser timezone. Explicitly reconcile historical paid future reservations without changing historical Stripe/booking data automatically.
- [ ] Test anon, unrelated Driver, paid confirmed Driver, cancelled Driver, Host, service_role, public API, private photo bucket and all legacy image links in isolated environment; audit EXIF and caches.
- [ ] BetterQA perform genuine Stripe TEST connected-account signed webhook, first-delivery 500/retry, wrong account/amount, parallel bookings and extensions, 409/429, refunds and disputes.
- [ ] Tudor and BetterQA approve exact SHA, QA project IDs, prepared versioned migrations, database backup/restore plan, test pause, QA deployment maintenance window and go/no-go owners.
- [ ] During that approved window only: back up QA, apply tested QA-only migrations, deploy matching app to QA, run smoke tests, obtain sign-off. Production requires a separate approval.

## Coordination request to Tudor
Please propose a QA maintenance/retest window and confirm who owns (a) the read-only preflight and migration review, (b) validated QA backup/recovery, (c) time-zone and historical reservation verification, (d) TEST-mode connected-account webhook and payment exercises, (e) Storage/RLS privacy probes, and (f) go/no-go release sign-off.

The privacy SQL revokes public raw reads and therefore cannot safely be promoted by itself while the legacy app remains in service. Database and matching app cutover must be coordinated; Vercel rollback does not reverse SQL migrations or payment changes. If validation fails, STOP and follow the approved recovery plan rather than attempting an ad hoc rollback.

**Hard boundary:** NO merge to main, no active QA alias promotion, no connected Supabase schema/data writes, no live Stripe actions, no paid booking changes. Passing tests and this document do not constitute deployment authority.
