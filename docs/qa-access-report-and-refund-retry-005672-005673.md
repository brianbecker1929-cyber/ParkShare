# BUG-005672 / BUG-005673 — prepared fixes, November 12

These fixes are isolated on `fix/bug-005672-005673-recovery-nov12`, based on
`072629e16b35970bcae1260ab2e5660ece2b08d8`. They are not applied to the frozen
`qa/recovery-preflight-oct27` branch, its recovery-QA alias, or production.
No database migration, worker/scheduler change, or real payment/email test is required
to prepare this patch. Deployment and BetterQA retesting remain separate steps.

The supplied BetterQA message describes the two findings and reports that BUG-005661
now passes with actual TEST Host reimbursements. Direct BugBoard ticket reads require
sign-in in this session; the repairs below were reproduced from the supplied report
against GitHub's exact frozen source, rather than assuming unseen ticket details.

## BUG-005672: access-report copy

When the Driver selects **Problem with the parking space or access**, the modal no
longer displays the card-refund settlement timing. The support-review explanation,
active-booking notice and **Request support review** action remain. Ordinary eligible
Driver and Host cancellation dialogs retain their refund guidance and time limits.

## BUG-005673: acknowledge a completed partial-refund retry

Previously, a repeat request was checked against the booking's new remaining balance
and Stripe's already-refunded charge before its saved operation could be recognized.
For example, issuing CAD 60 from a CAD 100 payment and retrying the same request
produced HTTP 400 because only CAD 40 remained, despite no second refund being issued.

The endpoint now validates current account authority and the request's fixed intent,
then looks up its durable `(booking_id, request_key)` operation before new-refund
eligibility checks. A completed matching operation returns HTTP 200, its original
operation ID, and **This partial refund has already been processed.** No worker,
Stripe read/write, new refund, transfer or reservation is needed on that replay.

The original requester, actor, action, reason, trimmed explanation, fee payer, amount,
payment/charge/account, mode, currency and original payment total must still match.
A reused reference with different details returns HTTP 409 `request_conflict`.
New request IDs still have to satisfy all remaining-balance and eligibility checks.
Concurrent lookup/reservation races are also checked before running the worker.

Pending operations return HTTP 202 with their existing state. A successful customer
refund awaiting reconciliation or fee credit is distinguished from a completed
operation; review/failed operations remain review-required. Reading a saved request
does not retry its financial work or bypass the worker's leases, reconciliation,
payment identity checks, idempotency keys, fee caps or 24-hour retry safeguards.

## Validation

Both reported failures were reproduced by new tests against the unmodified frozen
application/handler: access-report refund timing was present, and the completed
CAD 60 retry returned HTTP 400 instead of HTTP 200.

- Focused policy, worker, dialog and retry tests: **100 passed**.
- Application build: **passed**.
- Local full regression: **1,799 passed, 0 failed, 2 skipped** without a local
  `TEST_DATABASE_URL`. Database-enabled regression and schema rehearsal results are
  recorded in the draft PR's checks for its published head.
- Financial/provider behavior is simulated in tests; no Stripe or email action was
  performed against production, recovery QA or another hosted account.

Focused command:

```sh
node --test test/qa-cancellation-deadline.test.js \
  test/qa-partial-refund-retry-005673.test.js \
  test/cancellation-fee-policy.test.js test/cancellation-fee-operations.test.js
```

## Acceptance after a separately coordinated deployment

1. Select the Driver access-problem reason. Confirm that no card-refund timing appears,
   the booking remains active, and the action remains a support-review request. Switch
   to an eligible ordinary cancellation reason and confirm its refund timing remains.
2. On a fresh TEST booking, issue a Host partial refund larger than the resulting
   remaining balance (for example CAD 60 from CAD 100). Retry the exact request ID and
   payload after settlement; expect HTTP 200, the same operation ID and confirmation.
3. Repeat with a ParkShare-funded staff partial refund. Confirm the retry creates
   neither an additional customer refund nor a second Host reimbursement.
4. Retry while pending or awaiting reimbursement/reconciliation; expect an accurate
   HTTP 202 status, not a false completion. Review-required operations stay flagged.
5. Reuse the reference with a different amount or explanation; expect HTTP 409 and no
   financial action. A different ID for a new refund must still fit below the remaining
   payment. Verify unrelated users and forged staff requests remain denied.

Keep the original frozen build unchanged while BetterQA's current run/report continues.
Do not mark these two findings QA-passed or Ready to Release from this draft alone.
