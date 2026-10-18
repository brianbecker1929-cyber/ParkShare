# ParkShare x BetterQA — Controlled QA integration and release sign-off
**October 18, 2026 · DRAFT REVIEW PLAN, not deployment authorization**

## Purpose / invariant
Do not integrate directly into production `main` or point a preview at the active `parkshare-qa.vercel.app` alias. Current repairs are mostly **separate draft PRs**, often built on the same QA release base, so isolated CI green checks are **not** proof that the combined code and SQL work together.

This document is a readiness and approval plan. It does NOT apply migrations, merge branches, replay Stripe events, create refunds, delete records, or deploy changes.

## Read-only schema reality checked on October 18
| Relevant prerequisite | Active BetterQA QA database | Live production database |
| --- | --- | --- |
| `bookings.listing_id` | ON DELETE RESTRICT | ON DELETE CASCADE |
| `bookings.renter_id` | ON DELETE CASCADE | ON DELETE CASCADE |
| `listings.host_id` | ON DELETE CASCADE | ON DELETE CASCADE |
| `create_booking_hold` | Present | Present |
| `apply_paid_booking_extension` | **Absent** | **Absent** |
| `reserve_extension_checkout_hold` | **Absent** | **Absent** |
| `pending_booking_extensions.hold_id` | **Absent** | **Absent** |
| `booking_extensions.refund_reconciled_at` | **Absent** | **Absent** |
| `listings.timezone` | **Absent** | **Absent** |

These are schema metadata only, not tests of actual Stripe payment status. Check again immediately before any approved release.

## Integration clusters and dependencies

### A — Paid booking and Stripe integrity: MUST integrate as one code path
- **PR #143**: ParkShare-created Checkout snapshots and verification; migrations 011, pending Stripe Session transition audit
- **PR #166 → #175 → #177 → #178** (stacked in that exact sequence): transient DB reads; unresolved paid FK references; expired/failed Checkout protections; account-scoped refund/dispute updates
- **PR #160 → #174** (separate stacked series): atomic paid extension plus audit columns; reserve extension time *before* Stripe Checkout; requires `apply_paid_booking_extension`, `reserve_extension_checkout_hold` and `pending_booking_extensions.hold_id`
- **PR #167**: unpaid hold-abuse limits, changes `create_booking_hold`; proposed quota thresholds are NOT an approved product policy
- **PR #156**: read-only production Stripe reconciliation; use as an investigation/runbook, never a migration or webhook replay

**BLOCKER A1 — SQL lock order proven in source:** PR #167's `create_booking_hold` acquires the Driver advisory lock `pg_advisory_xact_lock(5118, hashtext(renter::text))` then the listing advisory lock. PR #174's `reserve_extension_checkout_hold` first takes the listing advisory lock, then invokes `create_booking_hold`, which would take the Driver lock. Parallel normal booking vs extension for the same Driver/listing may now form a lock-order cycle. **Resolve using one global lock order (Driver → listing) and regression-test both API paths concurrently before integrating.** Do NOT merely cherry-pick both proposals.

**BLOCKER A2 — refund representation:** The main booking row represents one refund ID; legitimate multiple partial refunds require a transaction/refund ledger and policy. PR #178 fails closed for a second refund rather than overwriting the first ID. PR #160 records extension-level refunds separately; full dispute lifecycle (created → won/lost) also requires an explicit support policy. BetterQA must verify with Stripe TEST before sign-off.

**BLOCKER A3 — migration and rollout ordering:** The atomic extension API must never be deployed without the matching signed-off SQL RPC, audit columns, hold linkage and service-role EXECUTE grants; the payment-integrity app changes require trusted Checkout snapshots from migration 011. Old outstanding Stripe Sessions must be audited before a snapshot cutover. No migration has been run through this plan.

**BLOCKER A4 — the actual BUG-005158 cause:** Identify real failed `checkout.session.completed` Stripe TEST event ID(s), connected account, `livemode`, webhook destination, and the exact Supabase FK/transport code before claiming root cause resolved. 84 prior production log occurrences are NOT 84 known affected paid transactions.

### B — Booking availability, exact price and property-local time
- **PR #159 (BUG-005156)**: canonical parking-property timezone and proposed migration (required before treating “today” or session times as reliable)
- **PR #154 (BUG-005160)**: per-spot held/confirmed status in preview/satellite; must integrate with correct property-local booking window
- **PR #171 (BUG-005138)**: Host schedule exception cannot be in the property's past; depends on verified property timezone from #159
- **PR #169 (BUG-005137)**: new/edit pricing; compare against **PR #152 (BUG-005147)** exact integer-cents UI/Stripe breakdown, preserving historical >$200 listings
- **PR #170 (BUG-005136)**: Canadian postal code validation; **do not force legacy invalid listings to be rewritten** without owner-reviewed data migration

**Block until tested:** overlapping Spot A/B/C/D holds; double bookings, timezones / DST changes, fractional price + service fee + refund totals; booking extension during timezone/day boundary.

### C — Public listing performance and private location security
- **PR #161 (BUG-005183)** privacy-safe discovery and authorized exact-address and imagery endpoints plus RLS/Storage permission proposals
- **PR #157 (BUG-005157)** lightweight dashboard booking payload
- **PR #151/#153 (BUG-005161)** public listing performance / historical Base64 covers
- **PR #146 (BUG-005135)** modern listing photo storage migration 013

**High-severity blocker:** Performance cover-image URLs must NOT bypass PR #161's private address/photo authorization model. Verify signed-out REST/PostgREST/Storage access directly and ensure no exact address, identifying listing photo, Host ID or reviewer identity can be mass-enumerated. Raw Storage public bucket access and project-wide RLS require staged security testing, not just hidden JSX fields. Confirm large-image legacy compatibility and search load tests.

### D — Account protection, communications and mobile UX
- **PR #141 + #149** listing delete safeguards; QA's listing FK currently RESTRICT but production's still CASCADE
- **PR #176** Host/Driver account delete/history constraints: requires a lawful privacy-preserving closure/data-retention policy BEFORE deploying, not indefinite blanket denial of deletion requests
- **PR #163/#162** verified reviews and protected private Host/Driver messages
- **PR #168 (BUG-005128/129)** cross-tab authentication and rehydration
- **PR #172 (BUG-005133)** About Us mobile headings; **PR #173 (BUG-005141)** Facebook link disabled only until official public URL is verified
- **PR #145/#147/#148/#150** authorization, spot picker, Host transaction state and combined pre-existing QA release-candidate updates

## Proposed controlled workflow — NO ACTION UNTIL EXPLICIT OWNER / BETTERQA APPROVAL
1. **Freeze scope**: assign each included draft PR an owner, target QA release-candidate SHA, and one unified integration branch based on the approved QA release candidate. Explicitly leave live `main` untouched.
2. **Design review blockers A1–A4 and C security**: resolve lock-order cycle, refund-policy gaps, exact Stripe incident evidence, RLS/Storage privacy boundaries, and property timezones. Assign separate unresolved tickets where code scope differs.
3. **Resolve source conflicts**: only one final version of `api/stripe-webhook.js`, `api/create-extend-session.js`, `api/_lib.js`, `src/App.jsx` and relevant SQL functions may survive. Review integration diff instead of relying on individual green PRs.
4. **Versioned database migration review**: order migration 010/011 where needed, existing 012/013, then approved timezone/hold/atomic extension/refund audit/privacy RLS/account retention; check existing QA schema before applying, never run the same migration again blindly. Use **disposable copied PostgreSQL first** and record rollback constraints.
5. **Integrated CI on the exact combined SHA**: all unit, database, price, security, accessibility and build tests; enforce no skips in payment/database suites and inspect Vercel preview configuration. Performance and privacy probes must be rate-limited.
6. **BetterQA isolated environment retest**: run connected Stripe TEST card checkout, decline, extension, return URLs, expires/async_failed, delayed/out-of-order refund and dispute; concurrency of Driver hold vs extension; Host payout/account; message/RLS and published listing image/privacy; local DST.
7. **BetterQA active QA maintenance window**: only once user explicitly authorizes exact migrations and deployment, publish code to the **QA Vercel project** after schema passes and smoke-test before restoring testers; preserve rollback snapshot. Do not promote to production.
8. **Written sign-off and release gate**: Tudor/BetterQA documents pass/fail evidence and outstanding Sev High bugs; owner approves payment/refund/retention policies and release SHA; verify monitoring and support escalation. Production launch is a separate future authorization.

## BetterQA test evidence / sign-off form (fill with real evidence)
| Gate | Acceptance evidence | Owner | Status |
| --- | --- | --- | --- |
| Payment & Connect | Checkout Session/event IDs from Stripe TEST, connected account, fee/refund, no duplicate booking | BetterQA + ParkShare | NOT STARTED |
| Database migration | Approved SQL SHA, ephemeral install+rollback rehearsal, grants/RLS, exact schema diff | Engineering | NOT STARTED |
| Holds and extensions | Concurrent Driver+listing lock-order, exact spot, expiry, out-of-order webhooks | BetterQA | BLOCKED A1 |
| Refunds/disputes | Partial/full/second refund policy, connected account, retry and dispute outcome tests | Product + BetterQA | BLOCKED A2 |
| Privacy | Anonymous query/Storage cannot mass-reveal exact address or private photos/IDs | BetterQA security | BLOCKED C |
| Timezones & pricing | DST, property-local start/end and integer-cent fee match | BetterQA | NOT STARTED |
| Host/Driver account deletion | Consent/retention policy; no financial history loss; approved closure path | Product/privacy + BetterQA | BLOCKED |
| Integrated PR | Combined branch SHA, reviewed diffs, CI and both Vercel preview checks green | Engineering | NOT STARTED |
| QA promotion | Owner approves exact QA project, maintenance window and schema/runbook | ParkShare | NOT AUTHORIZED |
| Production promotion | Separate subsequent owner authorization | ParkShare | NOT AUTHORIZED |

**No one should mark an item PASS based solely on a separate draft PR's existing green checks.** Keep BetterQA tickets open pending their own acceptance results. Use private ticket context for Stripe event identifiers and avoid copying real customer personal data or secrets into PR comments.

## Current release posture
**NOT READY FOR ACTIVE QA OR PRODUCTION.** This is a read-only verified integration checklist and written work plan. It does not perform a combined release, execute SQL, replay events, alter Stripe funds or modify active QA/production.
