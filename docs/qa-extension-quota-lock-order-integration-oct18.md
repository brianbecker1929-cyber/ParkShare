# BetterQA integration follow-up: Driver/listing advisory lock order
**Oct 18, 2026 · stacked DRAFT on PR #174; no migrations or deployments**

## Verified source conflict
- Unpaid-hold abuse proposal PR #167 overrides `create_booking_hold` and takes `pg_advisory_xact_lock(5118, hashtext(p_renter_id::text))` **before** `pg_advisory_xact_lock(p_listing_id)` to serialize cross-listing Driver quotas.
- Existing extension proposal PR #174's `reserve_extension_checkout_hold` took `pg_advisory_xact_lock(v_listing_id)` **first**, then invoked `create_booking_hold`. If #167 were installed, that nested RPC would attempt to acquire the Driver lock second.
- Concurrent normal booking and extension checkout for the SAME Driver and listing could wait on one another with opposite lock order. This is an engineering risk **confirmed in the draft SQL**, not an observed production deadlock.

## Prepared compatibility fix
- The extension reservation RPC now acquires the Driver quota lock **first**, then the listing lock, and only then calls the existing booking-hold RPC. PostgreSQL advisory transaction locks can be reacquired by the same transaction.
- Paid-extension final confirmation retains only the listing transaction lock; no new Driver quota lock is needed to apply a previously held paid extension.
- Existing precise PostgreSQL start/end, Host/Driver checks, spot capacity/hold rules and service-role-only permissions remain unchanged.
- New unit and disposable PostgreSQL SQL-function introspection tests ensure order is Driver → listing → nested hold.
- Existing atomic extension, duplicate webhook, conflict/rollback and checkout tests remain in the same CI run.

## BetterQA integration gate
- Rehearse both PR #167 and PR #174 SQL proposals **together in a disposable database first**. Verify advisory-lock order at the installed-function level and run actual concurrent normal checkout vs extension for the same Driver/listing.
- Review whether extension holds count toward #167's proposed quota of 2 active holds, 4 in 2 hours and 12 in 24 hours. These figures are proposed product limits, not approved policy. Ensure legitimate extension requests are not inadvertently blocked.
- Verify unrelated Drivers and listings can continue concurrently while one Driver is rate-limited.
- Test 409 conflict vs 429 rate limit responses before Stripe checkout starts. The new reservation endpoint currently handles `P0001` but may require a separate mapping for `P0058` when #167 is included. **Treat as a remaining integration blocker until addressed.**
- Run Stripe TEST on the final combined code and migration, including 30-minute holds, concurrent extension purchases, delayed webhook and refund/dispute events.
- No standalone deployment of this patch: it depends on PR #174's service-role reservation function and must be reconciled with #167's quota RPC.

**Review only; no changes to production, active BetterQA QA, live Stripe or customer records.**
