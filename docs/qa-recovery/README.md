# ParkShare-QA replacement preflight — October 27, 2026

Source deployment: `2ae1c71bd119984675ff57a067dff9e3a79627ae`.
Source Supabase: `biydlfekindgaslgktsx`, Canada Central.
QA Vercel: `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC`.
The live production project `oyxrussraxjgqwzpwyca` is not a recovery target.

## Current state

The original database responds to read-only SQL. Its Auth/Data API return 521;
QA parking search/readiness return 503. No restart, resize, source schema change,
data migration, paid resource or alias switch has been performed for this recovery.

Read-only inventory: 16 application tables, 17 application functions, 19 public/storage
policies, 24 recorded migrations, 34 Auth accounts and one storage bucket with four
recorded objects. Logical row text is approximately 120 MB; listings and reminder
payloads account for almost all of it. A catalog inventory is not a database backup.

The owner selected a separate QA organization. It does not yet exist in the connected
Supabase account. The current connection can list organizations but cannot create one.
Create the new organization without creating or moving any projects first. Then obtain
and approve its subscription and project costs before provisioning paid capacity.

## Secure source database export

The prepared workflow uses a new repository Actions secret named
`QA_RECOVERY_SOURCE_DATABASE_URL`. Enter the original QA project's direct database
or session-pooler connection string there, with its existing database password URL-encoded.
Use the original QA Connect panel. The frontend anon/service keys are not database passwords.
Do not reset the source password simply to fill this secret without reviewing the impact.

The source validator permits only the fixed original QA project and SSL, excludes
production and transaction-pooler port 6543, and never prints the credential. The job
performs the documented Supabase CLI logical export (roles/schema/data), encrypts the
archive to the recovery public certificate, and uploads only ciphertext. Missing credentials
fail before export. No restore, migration, source restart or compute change is included.

The private decryption key is held outside the Git repository in the owner's recovery
handoff package. It must never be committed, shared in BugBoard, or uploaded as a GitHub
artifact. The encrypted GitHub artifact is retained for one day; download and retain the
verified encrypted backup promptly. The logical export still requires a trial restore and
record-count/relationship checks before calling it a verified recovery backup.

## Replacement stages

1. Confirm the new organization's exact subscription/project quote and approve cost.
2. Complete the encrypted source export and verify checksums after decryption.
3. Provision a new project; verify empty Auth/Data API health before importing.
4. Restore reviewed application schema, users/identities, data, grants, RLS, functions,
   sequence states and migration history. Review managed Auth/Storage customizations;
   do not blindly overwrite the new project's managed service schemas.
5. Copy the four storage objects and verify bytes/paths separately. A database export
   records storage metadata, not the actual files.
6. Configure Supabase Auth site URL/redirects and custom SMTP. Reuse or re-enter email
   credentials securely. Vercel's QA secret variables cannot be read back; retain them
   on the existing QA project or obtain new values rather than exposing them.
7. Update only QA Supabase URL/public key/server key pairs. Preserve Stripe TEST keys,
   webhook verification, email, Maps and cron settings. Keep background delivery jobs
   disabled on the replacement until old queued reminders/refund emails are reviewed,
   avoiding duplicate sends. There must be only one active worker path at cutover.
8. Adjust the explicit old-project guards in `api/qa-release-status.js` and
   `api/_email-preview.js` for the new QA project. Keep production excluded.
9. Validate a temporary deployment: Driver/Host login, own-profile loading, listings,
   booking/spot conflicts, test checkout, signed webhook, extension/refund, email links,
   Storage access and all readiness checks. A 200 health endpoint is not end-to-end proof.
10. Switch the stable QA alias only after validation. Record the exact deployment and
    database project refs, preserve the old source and the rollback configuration, and
    tell BetterQA which accounts/data and release are ready for retest.

## Open dependencies

- A new separate QA organization and approved paid capacity.
- Existing source database connection credential entered as the repository secret.
- Successful source export and restore rehearsal; no database backup is claimed yet.
- Auth/SMTP settings and any unreadable credentials supplied through secure service settings.
- Actual target project ID/API keys; guard changes and the alias switch remain pending.

Official migration guidance:
https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
