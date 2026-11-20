# Account deletion cascade can destroy paid booking history
**ParkShare October 18, 2026 — independent security/financial-record safeguard, review-only**

## Confirmed source/database behavior
Read-only checks of **both ParkShare QA and production** found:
- `public.bookings.renter_id → public.profiles.id ON DELETE CASCADE`
- `public.listings.host_id → public.profiles.id ON DELETE CASCADE`
- `public.profiles.id → auth.users.id ON DELETE CASCADE`
- `public.booking_extensions.booking_id → public.bookings.id ON DELETE CASCADE`

Deleting a Driver profile could silently delete their booking history, including paid/refunded bookings and related paid extensions. Deleting a Host profile could delete their listings and, in production (where `bookings.listing_id` is also cascading), delete bookings and extensions from that property. Direct admin, automated cleanup, or account deletion processes can bypass UI safeguards.

**Already prepared elsewhere:** Migration 010 in draft PR #141 changes `bookings.listing_id` and `booking_holds.listing_id` to RESTRICT. It is already reflected in QA's database but NOT production's booking-listing FK. **This proposal does not duplicate or replace migration 010.**

## Prepared independent review-only fix
File: `docs/sql-proposals/qa-account-deletion-booking-retention.sql`

- Change `bookings_renter_id_fkey` from cascade to `ON DELETE RESTRICT`.
- Change `listings_host_id_fkey` from cascade to `ON DELETE RESTRICT`.
- PostgreSQL now rejects deletion of a parent profile if a Driver has any historical booking or a Host has any listing. This also causes an `auth.users` cascading deletion to fail atomically instead of silently removing records.
- A genuinely unreferenced test account may still be removed successfully.
- Both changes use one explicit transaction and short DDL lock timeout; mismatched constraint names fail the migration rather than skipping enforcement.
- No new role, RLS grants, public endpoints, client changes, user data snapshots, or attempted cleanup.

## Verified test coverage / needed BetterQA acceptance
Disposable-PostgreSQL integration tests must confirm:
1. Direct Driver profile deletion with **refunded** booking returns 23503; profile, listing and booking remain.
2. Driver `auth.users` deletion cannot bypass the guard via cascade.
3. Direct Host profile deletion preserves listing and historical booking.
4. Host `auth.users` deletion cannot bypass the guard.
5. Unreferenced account deletion remains supported.
6. A Host with an empty/unbooked listing is intentionally blocked until their listing is safely retired.
7. Both named foreign keys have `confdeltype='r'` after applying proposal.
8. Old migration 010 still blocks deleting booked listings independently.
9. Production payment/refund logs and saved booking-history totals remain unchanged.

## Critical product, privacy and rollout decisions
- **Do not deploy until an account-deletion policy is agreed.** Direct account removal for accounts with paid booking history will be blocked, which may affect customer rights under privacy regulations and support offboarding. Coordinate a **lawful privacy-preserving archival/anonymization workflow** and retention period, with legal/privacy review as appropriate, before applying to a real environment.
- The proposal may need adjustments for any customer profile deletion flow, support/admin account removal, GDPR/PIPEDA requests, host listings with zero transactions, or Stripe Connect account closure.
- Verify that retention is limited to legally necessary financial/audit records and avoid indefinite unnecessary personal-data retention.
- The existing `booking_holds.renter_id` currently cascades directly from `auth.users`. A future registered paid hold could be removed on account deletion if it is not yet represented by a booking. Coordinate with existing trusted checkout/hold PRs #143/#167 for pending-payment evidence retention.
- **No direct booking deletion protection** is added here; admin/service_role deletion and `booking_extensions.booking_id` remain separate audit/retention issues.
- Coordinate with pending PRs #141, #149, #150 and #175 before release; the new proposal should be a numbered approved migration only after both BetterQA and the owner approve the desired account-deletion behaviour.

## Release boundary
**DRAFT source and disposable CI tests only.** Do not execute on production or active BetterQA QA, merge to main, delete accounts/bookings, replay Stripe, issue refunds, or create operational migrations without additional authorization.
