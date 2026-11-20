# BUG-005661 — ParkShare-funded refund fee reimbursement

## Repair

The refund worker incorrectly required `refund.livemode` to match the operation. Stripe's Refund object does not provide that field (including the installed Stripe SDK's `types/Refunds.d.ts`); the successful-refund test fixture invented it. A real refund therefore entered `review` with `refund_identity_mismatch` before its ID was recorded, preventing fee allocation and the separate Host reimbursement.

The worker now retrieves the original Charge in the operation's connected-account context before a financial write. It verifies the Charge's ID, PaymentIntent, live/test mode, currency, original amount, paid/captured/succeeded state and dispute flag. Refund validation uses the documented Refund fields: object/ID, PaymentIntent, Charge, currency and amount. Expanded payment references are compared by ID, and retrieving an already-saved refund must return that same refund ID.

Refund success must still agree with the verified, account-and-mode-scoped refund ledger before fee allocation or transfer. The actual-fee proportional allocation, Host-funded zero-credit behavior, database lease, fixed provider idempotency keys and 24-hour ambiguity safeguards are unchanged. A fee credit is not complete without its recorded Stripe Transfer.

No schema change or database migration is required. This is a recovery-QA code repair; production rollout and the final frozen-build handoff remain separate.

## Verification

- Reproduced the defect before the repair by removing the fictitious `livemode` field from the Refund fixture: previously successful worker paths entered review.
- Focused worker/policy/API tests pass: 81 tests, including nested mismatch cases and the actual authenticated cancellation handler. They cover canonical Charge validation before refund writes, documented Refund shape, expanded references, saved-refund retrieval, pending and failed refunds, interrupted requests, stable retry keys, ledger gating, Host-funded refunds and exclusion of existing review operations. The handler's database fixture includes the real schema's CAD currency default.
- Full database-backed regression and application build results are recorded in the repair's QA handoff.

Automated provider calls use fixtures. They do not establish that a real TEST refund or transfer has succeeded.

## Existing review items

A read-only QA check on November 11 found two TEST operations in `review` with `refund_identity_mismatch`, no recorded refund status, no transfer attempts and no fee credit. The code deployment does not requeue them. The scheduler claims only queued operations, and the regression tests explicitly retain that boundary.

Before recovering either operation, reconcile its original connected-account refund and provider idempotency key in Stripe TEST, then attach only verified financial results through a reviewed recovery procedure. Do not blindly retry or reset the operation to queued: Stripe may already have accepted the refund even though the worker did not record it. No financial recovery is included in this code change.

## BetterQA acceptance

Use a fresh recovery-QA TEST booking and the dedicated QA staff account:

1. Apply an approved ParkShare-funded reason. Confirm the Driver refund, including the eligible application-fee portion, settles and is recorded once in the verified refund ledger.
2. Confirm a separate platform-to-Host TEST Transfer reimburses the actual eligible original Stripe processing fee. Record the operation, refund and transfer IDs, amount, currency and account. A pending marker alone is not a pass. Platform TEST funds must be available.
3. Check a partial ParkShare-funded refund: its proportional actual-fee credit is correct, the booking stays active and cumulative credits never exceed the original processing fee.
4. Check a Host-funded refund: no platform reimbursement is created.
5. Retry the same request and allow another scheduler pass: no duplicate refund or credit. Check the Manage refunds result agrees with the provider records.
6. Confirm Host/Driver direct requests cannot select staff-only reasons or choose their fee payer. Existing accepted policy remains the test oracle in `qa-cancellation-fee-policy-nov15.md`.

BetterQA owns acceptance. Keep BUG-005661 awaiting retest until the real TEST money movement and duplicate checks pass; do not interpret the local test or deployment as acceptance.
