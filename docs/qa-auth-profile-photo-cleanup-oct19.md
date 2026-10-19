# BetterQA 005165 / 005169 / 005187 — QA repair group

Built on PR #189, retaining the complete earlier QA release and map/list repairs.

- **005165:** No-session signup responses, including Supabase's obfuscated duplicate-user responses and explicit duplicate errors, show neutral confirmation/recovery guidance. The UI offers existing-account sign-in, password reset, and confirmation resend; it clears the signup password and does not claim a new account or email was created. Network failures clear the loading state. No email lookup endpoint is added.
- **005169:** `/profile` mounts the vehicle editor only for Drivers. `PATCH /api/profile` checks the database-owned role before any profile/Auth mutation. Editable Auth metadata and request-supplied role/identity cannot authorize a Host.
- **005187:** Host deletion goes through an authenticated, owner-scoped server API. Booking/hold FK restrictions remain authoritative. A successful DELETE atomically queues only the deleted Host's valid Storage paths, deduplicating covers and photo arrays. The server uses the Storage API, acknowledges successful cleanup, and retains failed jobs. A protected daily Vercel cleanup run retries pending jobs; paths still referenced by another listing are withheld. Direct database DELETEs also enqueue cleanup. No bucket access is widened.

## Validation and QA deployment

- 504 local regression tests passed; focused final-path tests passed; Vite application build passed.
- 56 local full-schema checks passed (48 prior release checks plus 8 cleanup checks): private queue/function permissions, owner-scoped RLS deletion, shared references, retry timing, owned paths, and blocked booking deletion. Native CI runs the same full-schema probe.
- Applied **QA-only migration `20261019164722_listing_photo_cleanup_005187.sql`**. Filename matches Supabase tracking. It only creates schema objects and does not backfill or delete historical photos.
- Immediately before/after migration: **32 bookings, 15 listings, 2 existing Storage objects**, unchanged counts; new cleanup queue empty. Browser queue access denied; service-role batch execution allowed.
- QA cleanup scheduler credential is server-only and scoped to the QA project's platform production environment. The daily schedule is 03:00 UTC; API deletion attempts cleanup immediately. A Storage failure is retried after one hour at the next scheduled run. This schedule does not send booking reminders.
- GitHub CI, deployment SHA/URL, live health and unauthenticated endpoint checks are recorded in the repair PR.

## BetterQA retest

1. Sign up with an already-confirmed address. Expect recovery guidance, no account-created success claim, and working sign-in/password-reset actions. Test a genuinely new address and unconfirmed address as well; confirmation resend remains available. Use QA test addresses.
2. As a Host, open `/profile` directly: expect Driver-account access guidance and no vehicle editor. A direct profile PATCH with a Host token returns 403 and changes no profile/Auth metadata. A Driver can still save their own primary/guest vehicles.
3. Upload photos to a disposable, unused Host listing and delete it. Expect the listing and its unshared Storage files to disappear. Test shared photo references and a temporary Storage failure: other listings' files remain and cleanup retries. Missing/already-removed objects are safe to retry.
4. Attempt deletion of listings with paid/refunded bookings or checkout holds: expect rejection and preserved listing/photos/history. A different Host/Driver cannot delete the listing.
5. Recheck prior map/list repairs, listing publish/edit and Host Dashboard refresh.

## Release boundaries

Only the active BetterQA QA project/database is a deployment target. No main merge, actual production change, existing photo purge, real payment/refund action, account creation, or email/reminder send is performed by this repair workflow. Signed-in browser, email-delivery and real Storage acceptance remain BetterQA retest items. Historical orphan cleanup requires a separate inventory/grace-period review; this migration does not guess which existing files are safe to purge.

Rollback: the queue migration is additive and compatible with the prior application. Keep it and its pending jobs if rolling back the UI/API. Disabling the cleanup scheduler pauses retries without deleting jobs; removing the table/trigger would lose the durable cleanup guarantee.
