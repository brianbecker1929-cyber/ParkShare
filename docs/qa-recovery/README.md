# ParkShare-QA recovery checkpoint — October 28, 2026

## Current state

The replacement database and private file restore **succeeded**. Driver and Host
password login and profile isolation passed API smoke tests. An isolated Vercel preview now connects to the replacement database. The stable
QA website has **not** been switched, so BetterQA's website retesting remains blocked.

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
The owner entered the replacement server key in the branch-specific Preview
variable on October 28. Vercel metadata confirms the update and the deployed
server's schema/ledger checks confirm the key works. An independent Preview
`CRON_SECRET` is also prepared; its next build will load it. Stable QA Production
environment values have not been changed.

## October 28 isolated preview and permission correction

Preview deployment `dpl_GsVscPwff8NLqGmTVcmsBm2mLY9d` is READY at
https://parkshare-7xluxin2l-eska-technologies.vercel.app for commit
`03be2ecfc87106d553e634413249f6c38691a8ef`. It has Preview target and only a
recovery-branch alias. Its server reads the replacement schema, refund ledger
and bounded parking RPC successfully; Stripe TEST/webhook and Maps settings
are present. Overall readiness remains blocked on email and scheduled-route
configuration, and website end-to-end checks remain pending.

The first deployment exposed an ACL mismatch the earlier count/RLS checks did
not cover: replacement default grants were broader on 14 application functions
and 13 public tables. Source and target catalog ACLs were compared. In a
target-only transaction, excess anon/authenticated privileges were revoked,
with exact precondition checks and normalized source-ACL equality checks before
commit. No application rows or source grants changed. Column-level profile
grants initially matched; the table-level revocations also removed them. They
were explicitly restored and verified in the later profile correction below. Archived owner-only default ACLs are
semantically equivalent. Publication and timezone readiness now both return true;
anon/authenticated cannot execute the publication RPC. Counts remain 34 users,
17 listings, 61 bookings. Do not treat row counts and RLS alone as complete
permission verification for any future restore.

The stable QA URL still reports its original application commit and failing
original-backend schema checks. Do not advertise recovery readiness or switch
the stable alias until remaining checks pass.

## Email configuration checkpoint — October 28

The owner created a separate sending-only Resend key named
`ParkShare-QA-Recovery`, restricted to the verified `myparkshare.ca` domain,
and entered it in branch-specific Preview `RESEND_API_KEY`. Only metadata
was inspected; the credential was not read back or logged.

Preview deployment `dpl_4u6SwFbUUuUp513fsc7iGAw61n46` is READY at
https://parkshare-ec2uc3m5l-eska-technologies.vercel.app for commit
`1cddf0c7f35a49abbbb2b0f6931f3433f52ddc21`.
`/api/qa-release-status` returned HTTP 200, `ready:true`, all 15 configuration/
database checks true. These presence checks do not prove email delivery or
payment webhook delivery.

Browser verification confirmed the home page and all 17 public parking results
load from the recovery deployment. The initial map failed with
`RefererNotAllowedMapError`. The owner added the fixed recovery branch host to
the QA browser key's allowed websites. Browser verification then rendered the
map, parking markers and 17 listings with no Google Maps errors. Use the fixed
branch preview alias for ongoing checks.
The owner reports saving Resend SMTP settings (sender no-reply@myparkshare.ca,
name ParkShare QA, smtp.resend.com:465, username resend), the fixed branch preview
Site URL, and exact origin redirects for that branch and stable QA. These settings
still need authentication email delivery/return verification.
A branch-only `APP_URL` override is set to the fixed preview origin.
The QA readiness guard now accepts that exact origin only with the recovery
backend, QA project ID and Preview environment; stable QA behavior is preserved.
Eight focused readiness tests passed, including wrong host/project/backend and
Production rejection. Payment/email return flows still need live verification. Do not announce readiness
or cut over before these remaining boundaries pass. No email was sent.

## Confirmed signup and profile-field permission correction

The owner's new Driver signup reached the replacement database. Resend recorded
the confirmation email as delivered, and the owner received and followed it.
Supabase confirmed the email and successful password authentication. The browser
then received HTTP 403 for its three-field profile read.

Diagnosis found the earlier table-level permission revocations had also removed
the existing column-level profile grants. Restored exactly the source's
`GRANT SELECT (id,name,role) ON public.profiles TO authenticated`.
The change was verified in one transaction using the new Driver and an existing
Host under the authenticated database role: each could read its own three fields
and could not see other profiles. Assertions also denied anonymous profile reads,
private email/Stripe fields and direct profile writes. An independent catalog
read confirms the exact three column ACLs now match the source. Schema cache was
notified. No account/password or application data changed during the correction.

Latest tested app commit `28c6ac31f2ff072aaf5edf66e6ce805159f6d4d1` passed GitHub
Tests and QA full-schema rehearsal. Its Preview server returned HTTP 200 with
all 15 readiness checks true. Synthetic email HTML returned HTTP 200 with seven
fixed-preview links and zero stable-QA links. Actual website sign-in needs the
owner's retry after the profile grant correction. Payment webhook/checkout and
stable QA cutover remain pending. No assistant-triggered email was sent.

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

1. The recovery server key is entered and verified. The branch-specific
   email setting and scheduled-route secret are loaded and configuration checks pass.
2. Verify replacement Auth site/redirect/SMTP settings saved by the owner and
   test actual authentication email delivery/return.
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
