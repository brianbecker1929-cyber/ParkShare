# BUG-005135 — QA listing-photo Storage rollout (PREPARED; NOT APPLIED)

**Scope:** ParkShare-QA only. This plan is for a BetterQA-approved maintenance
window. Do not run these instructions against live Supabase or deploy this
branch to `www.myparkshare.ca`. Prepare, review, and test in isolation first.

## Why this is needed

The current listing wizard writes Base64 photo payloads to `listings.img`
and `listings.photos`. This causes oversized Postgres requests and can time out.
The new wizard instead sends image files to Supabase Storage and stores their
HTTPS public URLs in the existing listing columns. Existing Base64 listings
remain readable and are not modified by migration 013.

## Exact planned configuration

| Parameter | Value |
| --- | --- |
| Project | ParkShare-QA (verify project before applying) |
| Bucket | `listing-photos` |
| Public | true: these are public driveway listing photographs |
| Maximum per object | `10485760` bytes (10 MiB) |
| Allowed content types | `image/jpeg`, `image/png`, `image/webp` |
| Maximum number in wizard | 6 |
| Object path | `<auth.uid()>/<random UUID>.<jpg/png/webp>` |
| Upload (INSERT) | authenticated Host, own UUID folder only |
| Listing/cleanup (SELECT) | authenticated Host, own UUID folder only |
| Delete (DELETE) | authenticated Host, own UUID folder only |
| Update / overwrite | no policy; `upsert: false` |
| Anonymous image downloads | permitted through **public object URLs** |
| Proof-of-ownership documents | **Never** upload to this public bucket |

Supabase documentation:
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/schema/helper-functions
- https://supabase.com/docs/guides/storage/schema/design

## Prepared GitHub artifacts

- `supabase-migration-013-listing-photos-storage.sql` — bucket + INSERT,
  SELECT and DELETE policies.
- `src/lib/listingPhotos.js` — allowed file types/sizes, random Host-scoped
  object keys, upload, partial-failure cleanup, legacy/new URL detection.
- `src/App.jsx` — object URL previews, progress/validation, publish to
  Storage, save only URLs, and show HTTPS images in listing cards.
- `test/database/listing-photo-storage-rls.test.js` — simulated authenticated
  Host/Driver security test in a **disposable** PostgreSQL database.
- `test/listing-photo-storage.test.js` — mock upload, failure, photo rendering.

These tests are not a substitute for exercising real Supabase Storage
operations in QA. They are intended to catch policy and application regressions
before the coordinated release.

## Preflight checklist (READ ONLY)

1. Obtain BetterQA's confirmation of a QA change window. Inform testers that
   listing publication may briefly behave differently during rollout.
2. Check the QA project ID and separately verify the live project is **not**
   selected.
3. Obtain a QA recovery snapshot/backup before schema or app changes, using the
   organization's supported recovery procedure.
4. Record the currently active QA deployment SHA and database listing count.
5. Confirm `listing-photos` does not exist, or inspect an existing bucket's
   settings before using the script. Never overwrite unexpected existing
   policies silently.
6. Review the SQL transaction and ensure the deployment's app code uses the
   same bucket name/path format. The first segment must match `auth.uid()`.
7. Confirm the Host role is stored in `public.profiles.role`. PR #145
   independently hardens listing creation RLS and should be coordinated.
8. Ensure a private ownership-verification document flow, if implemented in
   future, **uses a different private bucket**.

## Deployment order — requires approval; nothing below has been run

1. In the coordinated QA window, review/apply migration 013 to **ParkShare-QA
   only** using Supabase SQL Editor or the approved migrations workflow.
   The DDL is wrapped in a transaction.
2. Query `storage.buckets` to verify `public=true`, size limit and MIME list;
   query `pg_policies` to verify Host-only insert/select/delete and no UPDATE.
3. Exercise the Storage API with disposable Host and Driver test accounts.
4. Deploy the approved **combined** QA code to the Vercel `parkshare-qa`
   project only, after dependencies and other PRs have been reviewed. Do not
   merge to `main` or deploy to the live Vercel project.
5. BetterQA verifies publishing a listing with a large (6–9 MB) JPEG, six
   photos, normal small photos, mobile and desktop previews and display.
6. Confirm each **new** listing record has short HTTPS URLs, not Base64; older
   listings still have their original images and remain functional.

## Security test matrix for BetterQA

| Actor / action | Expected |
| --- | --- |
| Host A uploads `HostA/uuid.jpg` | Allow |
| Host A uploads `HostB/uuid.jpg` | Deny |
| Driver uploads in own directory | Deny |
| Anonymous uploads | Deny |
| Host B lists/deletes Host A's metadata | Deny |
| Host A cleans up own failed-upload object | Allow |
| Host A attempts replace/upsert existing object | Deny |
| Anonymous GET of public photo URL | Allow |
| Upload GIF, PDF, HEIC or >10 MiB image | Reject |
| Upload 6–9 MB JPEG then publish | Succeed; save URL only |
| Partial upload or listing insert fails | Inform user; cleanup uploaded objects |
| Existing Base64 listing renders | Preserve |
| New HTTPS cover renders in map, cards and booking page | Correct image, not raw URL text |

## Recovery and rollbacks

- **Do not drop the bucket or delete stored objects as a quick rollback.**
  Newly created listings may reference those URLs; deleting them would break
  images.
- If the new publishing flow fails, stop new QA publications, investigate and
  revert the **QA app deployment** as needed. Keep the bucket and the existing
  data intact.
- A rollback to an older app build that supports only Base64 images may display
  recently published HTTPS covers incorrectly. Assess that compatibility before
  rollback. This PR adds URL-compatible rendering, but the older active build
  does not have it.
- Verify no listing/booking records were deleted during an unsuccessful trial;
  investigate any orphan uploads using the **Storage API**, not direct edits
  of `storage.objects`.
- Retest once corrected before declaring BUG-005135 resolved.

## Open considerations / deployment gate

- The SQL is prepared in GitHub only. It has **not** been applied to QA.
- Browser-supplied file MIME types can be spoofed; the bucket MIME allowlist
  controls the declared content type but is not a malware/content scanner.
  Avoid accepting sensitive documents in this public bucket.
- End-to-end Host/Driver Storage operations and live images must be confirmed
  on QA, not inferred from mocked tests.
- Coordinate the next QA release alongside PR #145 and PRs #147–149 only once
  BetterQA approves. Production changes require separate approval.
