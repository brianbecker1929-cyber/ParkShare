# ParkShare-QA recovery checkpoint — October 27, 2026

## Environments

| Purpose | Identifier |
| --- | --- |
| Original QA Supabase | `biydlfekindgaslgktsx` |
| Replacement Supabase | `heqxirlsorcztsawaldg` |
| Recovery organization | `rsfbtpuwdtdzahrmkrxd` — ParkShare QA Recovery |
| Region | `ca-central-1` |
| QA Vercel project | `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC` |
| Current QA application commit | `2ae1c71bd119984675ff57a067dff9e3a79627ae` |
| Excluded production Supabase | `oyxrussraxjgqwzpwyca` |

The recovery organization is on Pro, purchased by the owner. Supabase quoted
$0 additional monthly for its first replacement project. The replacement was
created and basic Auth/Data API responses checked. It has no public application
tables and has not been connected to the QA website.

At the latest pre-export application check, the original Auth and profile Data
API returned 521; QA parking search and readiness returned 503. The current
website still uses the original backend. BetterQA remains blocked.

## Source backup completed

The owner reset the original QA database password after reviewing the impact
and added the credential privately as `QA_RECOVERY_SOURCE_DATABASE_URL`.
The website source and QA environment inventory use Supabase HTTP API keys.
Any separate direct database client using the old password needs updating.

[Backup run 40554102964](https://github.com/brianbecker1929-cyber/ParkShare/actions/runs/40554102964)
succeeded. It exported roles, schema and data read-only, encrypted before upload,
and cleaned up runner plaintext. The encrypted artifact was downloaded and
preserved separately from the repository.

Integrity verification:
- Encrypted ZIP size: 115310842 bytes.
- Encrypted ZIP SHA256: `5acd1c1f88d42c52ec0c25d8a3a93029227ce209621fed13c1efcd54257e1d04`.
- Export time: `2026-10-28T02:11:57Z` (October 27 in Toronto).
- CMS decryption succeeded using the private key from the original recovery handoff.
- All three SQL file sizes and checksums matched the manifest.
- Key COPY-block counts matched fresh direct SQL: 34 Auth users, 34 identities,
  34 profiles, 17 listings, 61 bookings, one Storage bucket and four object records.

This is an integrity-checked database export, not yet a restore-tested recovery
backup. It includes application/private/archive schemas as emitted by the CLI,
and account rows. It does not include actual Storage file bytes or project
Auth/SMTP settings. Supabase-managed schema customizations need separate review.
Migration history was captured in the earlier catalog inventory; the current
workflow does not separately dump `supabase_migrations`.

Never commit database URLs, passwords, the private decryption key, decrypted
SQL data or the encrypted backup to this repository. GitHub's temporary artifact
retention is one day; the downloaded persistent copy must be retained.

## Remaining restore and cutover stages

1. Obtain the replacement database connection credential as a separate GitHub
   Actions secret, `QA_RECOVERY_TARGET_DATABASE_URL`. It must identify only
   `heqxirlsorcztsawaldg`; never reuse the original source secret as a target.
2. Prepare and review a restore restricted to the exact replacement project.
   Refuse a populated target, preserve the source, use SSL, suppress sensitive
   logs and retain an encrypted checkpoint before target writes.
3. Restore and verify application/private schemas, accounts/identities, data,
   sequence values, grants, RLS, functions, migration records and reviewed
   managed Auth/Storage customizations. Compare counts and relationships.
4. Transfer the four Storage files separately and verify bytes and paths.
5. Configure Auth site URL/redirects, email settings and test integrations.
   Obtain unreadable credentials securely rather than putting them in chat.
6. Adjust QA-only Supabase project guards in `api/qa-release-status.js` and
   `api/_email-preview.js`. Update only QA URL/key pairs; preserve Stripe TEST,
   webhook, email, Maps and cron settings.
7. Keep new background delivery workers disabled until historical reminder and
   refund queues are reviewed. Only one active worker path may exist at cutover.
8. Verify a temporary QA deployment: Driver/Host login and profiles, listings,
   booking/spot conflicts, Stripe test checkout/webhooks/extensions/refunds,
   email links, Storage and all readiness checks.
9. Switch the stable QA alias only after validation, retaining rollback settings
   and the original project for Support. Record the exact deployment and project
   refs before telling BetterQA to resume.

No migration, source restart, compute resize or stable QA alias switch has been
performed during this checkpoint. The source password rotation and isolated paid
organization/project provisioning are recorded above.

Official migration guidance:
https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
