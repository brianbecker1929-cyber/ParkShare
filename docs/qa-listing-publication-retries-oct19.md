# QA follow-up: duplicate listing publication after a lost response

Code-identified issue; no BetterQA ticket ID assigned. Stacked on PR #194 and all prior QA repairs. QA only; no merge to main or actual production promotion.

## Behaviour

A Host publishing a listing could lose the HTTP response after the database committed. Clicking Publish again uploaded new photos and inserted another listing. Publication now has a random request ID and a server-generated canonical SHA-256 fingerprint of the original details. A service-only transaction serializes requests for the same Host/ID and saves the listing and receipt together. Replays return the original ID. Changed details return a conflict, and deletion leaves a receipt that prevents resurrection.

The browser retains the immutable submitted details, request ID and uploaded photo paths in tab-scoped session storage before sending the write. It stores no access token or photo blobs. Repeated clicks share the in-flight operation; lost responses and reloads reuse the receipt and uploaded photos. A recovery panel asks the Host to check publication before editing or starting another listing. Signing in with another account cannot resume the original Host's receipt. A new explicit listing gets a fresh ID.

A replay is checked before present-day validation and geographic lookup so an already-published request can be recovered after its exception date passes. Validation rejections are also recorded under the same database lock: only a committed rejection authorizes browser photo cleanup. A racing success wins instead of having its photos deleted. Auth failures, timeouts, conflicts and malformed responses retain the receipt/photos. A deleted listing uses the existing server cleanup queue; the browser does not remove its photos again.

The guarantee covers the same saved publication request. Separate new forms with distinct request IDs are intentional new submissions, not address-based deduplication. Closing the tab/browser session or manually clearing tab storage can remove browser recovery details; the database retains committed receipts. Existing listings, historical duplicates and orphan photos are not backfilled or purged. A storage-upload response lost before publication begins remains covered by existing upload handling, not this publication ledger.

## Verification and retest

- Regression tests cover lost responses, concurrent clicks, reload recovery, original-body/photo reuse, account changes, storage failure, validation/authorization/conflict/gateway responses, deleted results, and HTTP replay before time-zone/date validation.
- Disposable full-schema probes verify browser RPC/table denial, role/ownership, payload conflicts, repeat recovery, deletion tombstones, atomic rollback when either listing or receipt writes fail, and immutable booking history.
- Native PostgreSQL 17 uses two independent connections to verify simultaneous success/success, rejection/success and success/rejection requests serialize correctly.
- BetterQA: publish a disposable Host listing; interrupt its success response and use Check publication. Reload the same tab before recovery, repeat rapidly, then confirm exactly one dashboard listing and one set of published photo paths. Check ordinary publishing, validation correction, new-listing creation, property timezone, Driver denial, and deletion followed by an old request replay.

No real account, listing publication, Storage upload/deletion, booking, payment, refund, reminder or email is performed during release verification. BetterQA's signed-in acceptance remains required.

## Release

Apply the additive `listing_publication_retries` migration to QA database `biydlfekindgaslgktsx` only after native CI passes. The private RLS-protected receipt table and invoker RPC are service-only with an empty search path; browser roles receive no access. Verify booking/listing digests and booking/extension/listing/refund/Storage counts before and after. Align the filename to the service-recorded version. Deploy the exact final native-tested SHA to QA project `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC`. Verify the new `listingPublicationReady` readiness flag, previous readiness checks, public browse and authorization responses.

The migration only creates schema objects and is compatible with the prior QA code. Rollback may retain it and its receipts. Reverting to the previous application removes retry protection for new requests, so pause/review uncertain publication attempts before a rollback. Do not drop receipts or rewind application data. The separate production project remains untouched.
