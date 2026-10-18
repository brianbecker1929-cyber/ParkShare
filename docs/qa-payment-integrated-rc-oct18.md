# ParkShare / BetterQA — Combined Payment + Booking Integrity Release Candidate
**October 18, 2026 | Review-only integrated source, NOT deployed**

## This branch is a genuine integration (not merely a plan)
- Base ancestor: `qa/rc-betterqa-bugs-145-149-oct16`. Branch was created from the complete **draft payment chain PR #166 → #175 → #177 → #178**, then adds checked, review-only code and test changes from:
  - **#160 → #174 → #180**: atomic paid extensions, temporary extension checkout holds, Driver→listing lock ordering and quota HTTP 429.
  - **#167**: per-Driver unpaid checkout quotas, shared booking hold SQL proposal, normal checkout HTTP 429.
- Shared `api/stripe-webhook.js` was manually reconciled:
  - Keep bounded transient DB read retries and missing-parent reconciliation (no guessed automatic refund).
  - Keep signed Checkout failure/expiry protections and genuine payment-intent amount/account checks.
  - Keep base-booking refund/dispute account isolation and stale refund-event protection.
  - Replace original separate extension insert + booking hours update with single **`apply_paid_booking_extension` RPC**.
  - Add extension refund, charge snapshot and dispute auditing by connected account; never silently shorten paid parking hours or overwrite a second refund reference.
- The source includes new integration-specific disposable database regression `test/database/qa-integrated-booking-extension-quota-oct18.test.js` which installs **both** #167 quota SQL and #180 extension SQL into the same throwaway PostgreSQL schema and tests parallel normal vs extension holds and Driver quota rejection.

## Explicit exclusions / incomplete integration
**NOT yet included or approved for promotion:** BUG-005156 timezone #159, BUG-005160 spot preview #154, privacy #161/#157, Host schedule #171, pricing #169/#152, email and account closure #176, performance #151/#153, front-end authentication #168, Host postal #170, and other independent bug PRs. Include only after separate conflict/security review. These independent PRs are **not** implicitly merged by this branch.

## SQL and product blockers
1. **No migration run.** Proposed `docs/sql-proposals/bug-005118-unpaid-hold-rate-limits.sql` defines **quotas that require owner approval** (2 active holds, 4 issued/2 hours, 12/day). Proposed `docs/sql-proposals/qa-atomic-extensions-and-refunds.sql` depends on checkout snapshot migration 011 and creates `pending_booking_extensions.hold_id`, refund audit columns, `reserve_extension_checkout_hold`, `apply_paid_booking_extension`. These MUST be applied in an approved isolated environment **before** app code.
2. Integration test exercises quota RPC + extension RPC in disposable PostgreSQL and verifies consistent Driver→listing locking. It is not a substitute for load tests under real Stripe TEST webhooks or a migration rehearsal of actual QA schema.
3. Refund ledger supports **one refund ID per booking/extension**, not an arbitrary number of partial refunds. Second refunds require a product/financial ledger policy, support review and BetterQA sign-off.
4. Payments remain blocked from release pending the original Stripe failed event IDs/account/mode and live-vs-test webhook destination reconciliation, as documented in PR #156.
5. The privacy/address exposure in #161 remains high-severity until fully integrated and actively QA-verified; do NOT regard passing this payments-only branch as launch approval.

## BetterQA proposed acceptance
- Unit, integration/disposable PostgreSQL and app build on THIS unified branch SHA.
- Stripe TEST: correct Host/Driver/connected account fee and amount, double-booking, extension holds, concurrent booking vs extension, cancelled/expired checkout, refund and dispute across base booking and paid extensions, webhook retry, duplicates and out-of-order events.
- Security: wrong account event must never change another Host's payments; no signed URL redirect or metadata impersonation; no accepting unregistered payment sessions.
- Error handling: 409 overlapping space, 429 Driver checkout quotas, HTTP 500 on DB failure, no auto-refund on missing parent only.
- Host and Driver booking display and reminder emails after confirmed extension, refund, cancellation.
- Verify no product/code promotion unless schema migrations are signed-off and actual Stripe TEST cases are recorded.

## Hard safety boundary
Draft PR only, branched from the QA release candidate lineage. **No merges to main, no promotion to active BetterQA QA, no Supabase migration/data writes, no Stripe API payment/refund/replay, no customer data edits.** Before release, BetterQA and ParkShare must explicitly approve the exact integrated SHA, SQL migration plan, test evidence, environment and QA maintenance window.
