# ParkShare-QA recovery checkpoint — October 27, 2026

## Current state

The replacement database and private file restore **succeeded**. Driver and Host
password login and profile isolation passed API smoke tests. The QA website has
**not** been switched, so BetterQA's website retesting remains blocked.

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

## Private files and password login verified

[File-copy and Auth smoke run 40625576738](https://github.com/brianbecker1929-cyber/ParkShare/actions/runs/40625576738)
passed both private-bucket checks, downloaded all originals, encrypted a checkpoint
before target writes, uploaded all four files and verified every download checksum.
The four files total 16220907 bytes. Both buckets remain private, and object owner
fields match. Three active listing cover/photo references were relinked in the
replacement; no original-project photo URLs remain in `public.listings`.

Disposable Driver and Host accounts each passed password login, own-profile reads
and cross-user profile isolation. Both accounts were signed out and removed.
Original accounts remain unchanged: 34 users/profiles. No emails were sent.

The encrypted file ZIP SHA256 is
`f2e6bd7525d419b28ec2006e7c388f9a714e90f576f8dc12c836ce0feb79ceb8`.
Its digest, CMS decryption and all four inner file checksums passed independent
verification. The checkpoint and non-sensitive reports are retained outside Git.

Copied delivery review found no unsent reminders and two historical, unprepared
refund-notification jobs. Those two copied jobs were held with `blocked_at` in
the replacement to prevent automatic historical sends. Originals are unchanged;
the database checkpoint retains the prior state for later reconciliation.

The six URL/public-key/Maps/sender configuration overrides are prepared only for
Preview branch `qa/recovery-preflight-oct27` in the QA Vercel project.
Vercel still needs the replacement server API key separately, scoped to that
Preview branch. Stable QA Production settings have not been changed.

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

1. Enter the replacement server API key securely in the QA Vercel project's
   Preview environment for branch `qa/recovery-preflight-oct27`. The GitHub
   Actions secret used for file migration cannot be read back through Vercel.
2. Configure replacement Auth site URL, redirect URLs and SMTP/email settings.
3. Finish the isolated QA deployment's email/cron settings, preserving Stripe
   TEST keys, webhook verification and Maps configuration. Keep only one active
   delivery path at cutover; historical refund jobs remain held for review.
4. Verify the website end-to-end: Driver/Host login and profiles, parking
   discovery, booking/spot conflicts, Stripe test checkout/webhooks/extensions/
   refunds, email links, private Storage access and all readiness checks.
5. Switch `parkshare-qa.vercel.app` only after these checks pass. Retain the
   original project and previous deployment for Support and rollback, then
   record the exact ready release and accounts for BetterQA.

Never rerun the restore against a populated target. Its guard refuses that case.
No source restart or compute resize was performed for this recovery.
Do not merge this isolated recovery branch into the production branch.

Official migration guidance:
https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
