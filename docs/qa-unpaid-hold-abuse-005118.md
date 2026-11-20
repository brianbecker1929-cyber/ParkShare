# BUG-005118 — Reduce unpaid parking hold abuse
**Draft only — October 17, 2026 — no active QA / production changes**

## Source-confirmed weakness and QA snapshot
- ParkShare's `create_booking_hold` protects last-spot concurrency for a single listing but does **not** cap the number of holds created by a single authenticated Driver across multiple properties or after previous holds expire.
- A signed-in Driver could repeatedly start Stripe Checkout, leave without paying and block capacity for the existing 30-minute hold duration.
- Read-only BetterQA QA database check: **1 historical hold, 0 currently active holds** at review time. This does not establish abuse; BUG-005118 was reported by BetterQA separately.
- The existing 30-minute hold and **7-day preservation of expired registered checkout evidence** remain unchanged. Do not shorten the hold without coordinating the actual Stripe Checkout expiration and delayed-paid-webhook handling.

## Proposed guarded fix
- Review-only SQL in `docs/sql-proposals/bug-005118-unpaid-hold-rate-limits.sql` replaces the existing registered-checkout `create_booking_hold` function **only when approved**.
- Enforce serialized, atomic issuance using a per-Driver advisory lock **before** the existing per-listing capacity lock. This prevents opening parallel browsers/tabs or checkout requests for different listings to bypass caps.
- Proposed policy: maximum **2 active holds** across all listings per Driver, **4 successfully issued holds per rolling 2 hours**, **12 per rolling 24 hours**. Counts include newly created holds whose Checkout later expires or is abandoned; denied attempts do not create holds or count as successful issuance.
- New private `booking_hold_attempts` table records minimal renter UUID, hold UUID, timestamp. It survives deletion of booking holds after payment or expiry and is readable/writable only by server/service role, with RLS enabled. No device fingerprinting or IP tracking.
- New SQLSTATE `P0058` is returned for the quota; checkout translates to user-facing **HTTP 429**, before it creates a Stripe Session. Ordinary lack-of-availability remains HTTP 409.
- No existing booking, payment, refund or checkout evidence is edited or deleted.
- This is **per-account protection**, not a complete defense against creation of many malicious accounts. Later device/IP/global abuse controls, CAPTCHA or reputation checks require a separate privacy/security decision.

## Risks and policy decisions
- A Driver legitimately making numerous reservations may encounter the cap; BetterQA/product should confirm the 2 / 4 / 12 thresholds.
- A hold issued immediately before a Stripe API/network failure still counts toward the rolling quota. If this causes false positives, approve an explicit release/reconciliation mechanism, never let clients reset their own limits.
- Do not silently delete `booking_holds` in an attempt to unblock an unpaid Driver: registered Checkout may still complete until Stripe's actual expiry, and a delayed webhook needs its trusted data.
- `booking_hold_attempts` has minimal identifiable data. Approve a retention/cleanup period (e.g. 30 days) in a separate maintenance job after audit requirements are confirmed; no cleanup of historical hold evidence is included in this patch.
- Existing active holds predating this rollout are included in the active count; historic abandoned holds before this table exists cannot be counted retroactively.

## BetterQA acceptance tests in a controlled isolated environment
1. Driver A starts two valid Stripe TEST checkouts for two eligible spots; third simultaneous attempt across other listings receives 429. Driver B can still book an available space.
2. Driver A creates four holds over 2h but cancels/lets each expire: fifth attempt receives 429. After advancing clock beyond policy window, another attempt succeeds.
3. Driver A has 12 issue records within rolling 24h but none in past 2h: next attempt receives 429. After 24h window passes, legitimate booking succeeds.
4. Six concurrent requests from same Driver on distinct available spots across one/multiple listings yield at most two holds. Existing capacity and letter-specific conflict checks still block double booking.
5. Signed-out users are blocked by existing authentication; client cannot query or mutate hold attempt audit table, directly call hold creation RPC, impersonate another Driver or reset limits.
6. Stripe checkout success, cancellation, expiration and signed webhook reconciliation retain original behavior; no refunds or charges are triggered by a rate-limit denial.
7. Check error UI on mobile and desktop and confirm acceptable accessibility. Monitor false positives and support requests before confirming thresholds.
8. Integrate PR #118's checkout change with PR #159 (property timezone) and PR #165 (trusted redirect), plus PR #166 (webhook retry). Test combined branch; do not merge this independently into live `main`.

## Release order
The new SQLSTATE requires server handling. **Deploy compatible application code first**, then the approved SQL within the coordinated BetterQA QA window, run Stripe TEST checks and verify rollback plans. Do not apply the SQL on the current BetterQA testing environment without explicit approval. Release to production only after signoff.

**Status: review-only SQL + application fix + automated tests. Not deployed, not approved, not merged.**
