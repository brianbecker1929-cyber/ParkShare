# BUG-005488 — Host listing removal and save feedback

Recovery QA / Stripe TEST only. The ticket screenshot shows the deleted listing
still on the 390px Host Dashboard with an Active label. The report also records
a second delete returning 404 silently and a 200 PATCH followed by a misleading
save failure. This repair handles those outcomes without weakening deletion guards.

## Behavior

- Delete still requires the separate native confirmation and acknowledgement.
  Only a confirmed server success removes a listing. The dashboard immediately
  removes that row/count and shows “Listing deleted.” beside Your listings.
  Pending photo cleanup is stated separately while still confirming deletion.
- A current Host's 404 delete means the listing is no longer available in that
  account. The stale card is removed with “It may already have been deleted.”
  A protected 409, provider failure or lost response shows an inline alert and
  retains the card. Unknown outcomes never claim a confirmed deletion.
- A per-Host mutation journal reconciles older dashboard snapshots with confirmed
  deletions and saves. Deleted listing IDs only are stored in sessionStorage,
  bounded to 256 entries, so an immediate same-tab reload cannot revive a deleted
  card. No listing title, address, vehicle, token or financial data is persisted.
  Storage failures degrade to current-page reconciliation; browser cache/storage
  cannot authorize a server action. IDs are permanent database identifiers.
- Confirmed edit values overlay older snapshots for the mounted dashboard. If a
  successful update returns no row representation, one owner-filtered read checks
  all editable values. Matching values confirm save; missing data reports the
  listing as unavailable; different values/read failure remain uncertain. The
  mutation is never automatically replayed. JSON object key ordering and numeric
  price formatting do not create false mismatches.
- Missing edit rows are hidden for the current view only, rather than recorded as
  proven permanent deletions. The fallback rechecks SDK account identity. Existing
  generation/account/unmount/duplicate-submit guards remain active throughout the
  read. Late replies cannot update another editor or expose another Host's notice.
- Save success shows “Listing changes saved.” beside Your listings. A missing-row
  edit closes the stale editor with availability feedback. Errors remain explicit.
- The account-bookings endpoint sets `Cache-Control: private, no-store` before all
  exits, including empty Host results, authentication/validation errors and outages.
  Dashboard reads retain `cache: no-store` and bearer authentication.

## History and scope

Database RLS policies were inspected read-only: Hosts select their own listings;
updates require both ownership and the database-owned Host role. Booking/hold FKs
remain ON DELETE RESTRICT. No permissions, schema, booking, refund, payment or
provider settings are changed; no actual hosted listing was deleted in verification.

The owner-approved cancelled-only archival requirement is tracked separately on
BUG-005115. This repair addresses stale cards and misleading confirmations; it
does not implement archival or report that cancelled-booking deletion is enabled.
Existing booking/checkout protection continues to return an explanatory 409.

## Validation and BetterQA acceptance

Automated coverage executes the actual delete/edit hooks, dashboard loading and
rendering, storage/reload reconciliation and actual account API handler. It covers
confirmed/gone/protected/uncertain deletion, empty PATCH verification, mismatches,
account changes during reads, A-B-A isolation, late snapshots, immutable payloads,
blocked/corrupt storage, bounds and feedback placement beside Your listings. New
dashboard regressions fail against the previous App. Full suite/build and existing
payment, private-location, booking-history and deletion-protection tests apply.
Browser automation is unavailable; real desktop/mobile acceptance is pending.

BetterQA / PARK-TC-087:

1. Use a disposable QA listing with no bookings or holds. Delete once at desktop
   and 390x844. Confirm the card/count update immediately and the visible success
   notice. Reload immediately and after 10 seconds; the card must remain absent.
2. Keep a stale copy open in another tab. After deleting elsewhere, attempt Delete
   there: confirm unavailable/already-deleted guidance and removal of that stale
   card. Reload that tab too. Each tab has its own session storage.
3. On a fresh listing, edit price/description/features/spots and save once. Confirm
   saved values and message, then reload to verify actual persistence. Simulate a
   200 update without representation: only matching canonical readback confirms it.
4. Edit a listing deleted elsewhere: confirm unavailable feedback, not “saved”.
   Fail/throttle responses; uncertain outcomes must never claim save/deletion.
5. Exercise duplicate clicks, close/unmount, account A-B-A and delayed responses.
   No old response or notice may affect a new account, card or editor.
6. Attempt removal of a booking/hold-protected listing: 409 and visible explanation;
   listing, bookings and payment/refund history remain intact. Archival acceptance
   is a separate BUG-005115 task. Keep all tests in QA / Stripe TEST.

Reference: https://supabase.com/docs/reference/javascript/using-modifiers-select
