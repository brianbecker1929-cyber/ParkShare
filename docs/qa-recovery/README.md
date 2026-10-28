# ParkShare-QA recovery checkpoint — October 27, 2026

## Current state

The replacement database restore **succeeded**. The QA website has **not** been
switched, so BetterQA's backend-dependent retesting remains blocked.

| Purpose | Identifier |
| --- | --- |
| Original QA Supabase | `biydlfekindgaslgktsx` |
| Replacement Supabase | `heqxirlsorcztsawaldg` |
| Recovery organization | `rsfbtpuwdtdzahrmkrxd` — ParkShare QA Recovery (Pro) |
| Region | `ca-central-1` |
| QA Vercel project | `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC` |
| Stable QA application commit | `2ae1c71bd119984675ff57a067dff9e3a79627ae` |
| Prepared QA guard commit | `6d9ef30ff059ff08dd03a2768923266112febff0` |
| Excluded production Supabase | `oyxrussraxjgqwzpwyca` |

The owner purchased Pro and provisioned its first replacement project at a quoted
$0 additional monthly. Source and target database credentials were entered as
separate GitHub Actions secrets after the owner reset their database passwords.
No passwords, API keys, private key or database rows are committed to this repository.

## Successful restore and verification

[Guarded restore run 40622226720](https://github.com/brianbecker1929-cyber/ParkShare/actions/runs/40622226720)
validated both exact project URLs, checked the target was empty, exported the
source read-only, and retained an encrypted checkpoint **before target writes**.
The restore ran in a single transaction, with row-count, relationship, catalog
and public-RLS checks before commit. It restored migration history plus the
custom Auth trigger and three Storage policies separately from managed schemas.

Verified by the restore and independent SQL/API checks:

- 34 users, 34 identities, 34 profiles, 17 listings and 61 bookings.
- All exported table counts match the fresh source snapshot.
- 16 public tables, all with RLS; 19 public/Auth/Storage policies.
- 20 application functions, 9 custom triggers and 24 migration records.
- Foreign-key relationship checks passed.
- Replacement Auth health and the events Data API probe returned HTTP 200.
- The original Auth/Data API still returned 521, and stable QA readiness 503.
- Target security advisories match the source's six existing categories, with
  no ERROR-level advisory. Existing warnings remain for separate review.

The QA readiness guard accepts the two fixed QA project URLs and requires
matching browser/server configuration. The synthetic email-preview guard also
recognizes the replacement while retaining its project/site restrictions.
Seven restore safety checks, 18 focused application checks, GitHub Tests and
QA full-schema rehearsal passed. No stable alias cutover has occurred.

## Encrypted recovery checkpoints

The original source export and the expanded pre-restore checkpoint are retained
outside Git. Both ZIP digests, CMS decryption and inner manifest checksums passed.
Keep the private key in the original recovery handoff private and separate from
shared test reports.

| Archive | SHA256 |
| --- | --- |
| Original source ZIP | `5acd1c1f88d42c52ec0c25d8a3a93029227ce209621fed13c1efcd54257e1d04` |
| Expanded pre-restore ZIP | `b1766b76c1cfd82e8cbefc8fb68433d29c7b9c45cf1f256e1083bc751476edd9` |

The expanded checkpoint includes roles/schema/data, migration schema/history,
managed schema customizations and verification material. Its ZIP is 115347194
bytes; all eleven manifest file checksums passed after independent decryption.
GitHub's ciphertext artifact retention is one day; preserve the downloaded copy.

## Remaining work

1. Copy and hash-verify the four actual private Storage files. Their metadata
   rows are restored; their bytes are not. The original `listing-photos` bucket
   is private, so secure server API access is needed for both projects.
2. Configure replacement Auth site URL, redirect URLs and SMTP/email settings.
3. Configure an isolated QA deployment with replacement API URL/key pairs.
   Preserve Stripe TEST keys, webhook verification, email and Maps configuration.
4. Review copied reminder/refund delivery queues before enabling background
   workers. Keep only one active delivery path at cutover.
5. Verify Driver/Host login and profiles, parking discovery, booking/spot
   conflicts, Stripe test checkout/webhooks/extensions/refunds, email links,
   Storage access and all readiness checks.
6. Switch `parkshare-qa.vercel.app` only after these checks pass. Retain the
   original project and previous deployment for Support and rollback, then
   record the exact ready release and accounts for BetterQA.

Never rerun the restore against a populated target. Its guard refuses that case.
No source restart or compute resize was performed for this recovery.
Do not merge this isolated recovery branch into the production branch.

Official migration guidance:
https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
