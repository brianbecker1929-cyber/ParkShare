# BetterQA complete prepared-repair release — October 19, 2026

Brian authorized deployment of ALL prepared repairs to BetterQA on October 19. This QA-only release supersedes the earlier draft-only restriction for this cutover. Production and the main branch remain outside scope.

## Source and coverage

Base: PR #187, commit `11ee96d5bf252ff4508b3cf04a064bffae0036ee` (all prior release candidates and PRs #183–187). Independently prepared PR #165 trusted Stripe return origins and PR #155 support inbox/Reply-To changes are integrated without overwriting the newer checkout, webhook, email or UI implementations.

| Prepared area | Bug IDs / changes |
| --- | --- |
| Authentication and confirmation | 005111, 005112, 005113; cross-tab 005128/005129 |
| Payment and booking integrity | 005114, 005115, 005116, 005118, 005139, 005147, 005158, 005166; terminal-event/refund/dispute guards |
| Listings and Host validation | 005135, 005136, 005137, 005138, 005140, 005142, 005152, 005160 |
| Payload and discovery performance | 005157, 005161 |
| Canonical property-local time | Foundations for 005156/005163; historical reservations still require individual reconciliation |
| Privacy and authorization | 005117 reviews, 005119 messages, 005183 listing/address/photos, 005200 profiles; account-deletion financial retention |
| Earnings and availability search | 005188 remaining refund earnings; 005174/005175 nearby search and empty states |
| Independent prepared fixes | 005133 About mobile layout, 005141 disabled unverified Facebook link, PR #155 contact routing, PR #165 trusted return origins |

Alternative older implementations (for example PR #153 versus the integrated lightweight/private discovery chain) are superseded, not independently layered over the current implementation. PR #156 is an operations/audit runbook rather than an additional runtime repair. Historical unrelated mascot/content PRs are outside this BetterQA release.

This does not claim that every reported bug is implemented or closed. In particular the supplied 005162/005164/005165/005168/005169/005171/005172/005173/005187 reports remain separate work unless BetterQA has independently changed their status.

## Verified QA targets

- Team ESKA Technologies: `team_uKdJGEbDlv6H0MaOmZfU0dQF`.
- QA Vercel project: `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC`, `parkshare-qa.vercel.app`.
- QA Supabase project: `biydlfekindgaslgktsx`, PostgreSQL 17.11.
- Previous active deployment: `dpl_2By14QGJDgxfYcoxzNsYEMVfqPeG`, source `42f27f85a18bf1c730b5d5d200b4ee8fdd3ec7e6`.
- Production is the separate Vercel project `parkshare-project` and separate Supabase project `oyxrussraxjgqwzpwyca`. Neither is a mutation target.

QA uses the **production environment of the QA Vercel project** for its stable QA domain. That platform target must not be confused with ParkShare's actual production project/domain. The QA APP_URL is confirmed as `https://parkshare-qa.vercel.app`.

## Versioned database cutover and recovery

`20261019091311_betterqa_complete_qa_release_oct19.sql` combines the ten rehearsed SQL proposals in their tested order into ONE transaction. It sets lock/statement timeouts, serializes the release, takes short write-blocking locks, snapshots all original public application tables inside a private QA-only recovery schema, records catalog definitions/ACLs and the photo bucket flag, and verifies copies against the original rows before changing schema. The recovery schema is not exposed to browser roles. No QA application/Auth rows or secrets are exported as artifacts.

A duplicate-review fault injected into the disposable full schema proves that a late failure reverses ALL earlier changes in this combined migration, including the recovery schema. A successful run preserves original paid booking JSON and UTC ranges. Blind reapplication fails; Supabase migration history and committed-stage inspection govern recovery. Repeated migration execution is not a rollback mechanism.

The recovery copy is a targeted, same-database pre-release recovery checkpoint, not a full managed Supabase backup, Storage blob backup, Auth backup or disaster-recovery certification. Files and Auth data are not modified by this release. Vercel rollback alone cannot undo RLS/schema changes. Preserve the recovery schema and use reviewed forward repair or restore the old catalog/permissions with the old app only after assessing intervening test activity. Never restore financial rows over newer transactions blindly.

`20261019091625_betterqa_verified_listing_zones_oct19.sql` assigns trusted property metadata only for independently checked, unambiguous geographic cells loaded into the private QA recovery schema. Geographic checking uses current `geo-tz@8.1.10` boundary data locally; no exact QA listing coordinates are exported. The cells and individual listing mappings remain in QA, not this repository. Six listings lack usable coordinates in the current preflight and must remain unassigned. No blanket Toronto or browser-timezone fallback is used. New listings outside verified metadata assignment also fail closed for scheduled checkout until their timezone is verified.

Neither migration reinterprets or rewrites legacy bookings, amounts, paid times, refunds or session ranges. Three future paid legacy bookings were identified in aggregate and remain unchanged pending booking-specific review. Historical availability JSON is also preserved; dated exceptions with a timezone mismatch require the Host/tester to correct their setup.

## Cutover and smoke verification

1. Verify exact release CI/build/preview checks and QA-only project/environment identities. Preserve the old deployment ID and the private recovery copies.
2. Pause the QA project briefly, recheck active holds/schema drift, and apply the atomic migration using Supabase migration tracking. Load reviewed private geography metadata and apply its versioned migration.
3. Build the exact release commit using the QA project's production environment, wait for READY, verify its commit/project/domain association, and resume QA. No main merge or production-project promotion.
4. Check QA-only `/api/qa-release-status`: QA database target, Stripe TEST key mode, configured webhook/email/Maps, QA links, required schema and exact Git commit. It returns no credentials/rows and is unavailable on the production database/project.
5. Smoke-test public parking/reviews, anonymous direct Data API denial, self-only profile/participant-only messaging policies, private photo bucket, authenticated route rejection without credentials, frontend routes and actual deployed source/configuration. Repeat manual desktop/mobile and genuine Stripe TEST acceptance with BetterQA.

No customer/team messages, actual charges/refunds/webhook replays or reminder sends are part of this deployment. Genuine Stripe TEST financial acceptance remains BetterQA's task. The known multiple-refund webhook persistence limitation, current 200-listing discovery feed cap and historical time reconciliation remain open.

CI results and final deployment/migration IDs will be recorded in the release PR after execution. Do not mark tickets closed merely because code is deployed.
