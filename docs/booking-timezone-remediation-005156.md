# BUG-005156 — Scheduled Booking Time Zone Correction
**PR #159 — integrated draft, NOT DEPLOYED or MIGRATED — October 17, 2026**

## Confirmed QA database and application mismatch
The existing PostgreSQL trigger `bookings_compute_session_range()` converts `booking_date + start_hour` as UTC, rather than the driveway's local time. Checkout and availability previously did the same, while confirmation emails displayed Toronto local time. A 2 p.m. Toronto booking on October 20, 2026 must start **18:00Z**, not 14:00Z; in Vancouver it must start 21:00Z. Remote browsers in Greece must not alter this.

Read-only QA inventory on October 17: **12 paid scheduled reservations, 9 dated in the future**. QA has **14 driveway listings, 6 missing lat/lng**. Do NOT silently adjust any booked instants or issue financial changes.

## Prepared application repair
1. `api/_booking-local-time.js` strictly resolves the literal local calendar date, 15-minute hour, and trusted IANA property zone into UTC. It rejects invalid zones, dates and ambiguous/nonexistent DST hours.
2. **Browse/checkout UI:** `src/lib/bookingCalendarDate.js` preserves the chosen wall-clock calendar day instead of converting via `date.toISOString()`. The same date-only value feeds availability and checkout.
3. **Checkout and availability:** Both fetch `listings.time_zone` server-side and use the same resolver. They do NOT trust browser timezone or a client-provided zone. Missing/unverified zones fail closed for scheduled reservations, but instant Park Now booking remains supported.
4. **Authoritative holds:** checkout registers `booking_holds.starts_at` and `ends_at` in UTC, and snapshots `property_time_zone` and `scheduled_starts_at` with approved Checkout metadata. Stripe cannot override the server-held interval.
5. **Webhook:** newly registered scheduled holds transfer their trusted `starts_at` into `bookings.scheduled_starts_at`; the property zone is stored as a snapshot on the booking. Existing registered legacy pre-rollout holds without canonical metadata keep their original UTC interpretation, without silently migrating paid sessions.
6. **Database proposal only:** `docs/sql-proposals/bug-005156-property-local-canonical-bookings.sql` adds nullable listing time zone and immutable scheduled-booking UTC start snapshot, and changes the booking session range trigger to prefer canonical start while preserving old `booking_date/start_hour` interpretation when canonical is absent.
7. **Downstream consumers:** server-side availability, reminder queries, confirmation/reminder email formatting and Host/Driver booking pages prefer canonical UTC starts and format newly scheduled reservation times in the property zone. Legacy booked records retain the old behavior until reconciled.
8. **Advance booked reservations:** removed `paid_at >= now()-31d` filters from availability and reminder scans; otherwise bookings paid months before their actual scheduled start would be incorrectly omitted.
9. **Host availability schedule zone:** checkout and availability now pass the server-verified `listings.time_zone` into Host weekly-hours/exception checks. Before this change, `availability.timezone` could have been created using a travelling Host's browser timezone; a Vancouver driveway could be treated as open at 9 a.m. Toronto/Greece instead of 9 a.m. Vancouver. Original Host availability objects remain unchanged and legacy no-zone requests retain pre-migration behavior. Regression tests cover summer/winter and mismatched presets.

## Coordinated release GATES — do NOT deploy this branch as-is
- The active production/QA databases do NOT have `listings.time_zone` or `bookings.scheduled_starts_at`/`property_time_zone` columns. Deploying this code without the matching approved schema would break requests.
- Map each listing to its correct IANA timezone using a **trusted geolocation + timezone service**. Do NOT guess Canada-wide `America/Toronto`. Manually verify missing coordinates and all existing listings; leave `time_zone` NULL to block scheduled checkouts until verified.
- Reconcile 12 historic QA paid scheduled bookings and inventory **production** history read-only before proposing any move. Retain paid original bookings, Stripe Checkout evidence, spot/session_ranges and existing emails. Obtain Host/Driver consent for any correction that changes a booked slot.
- Coordinate one atomic QA release window with BetterQA for application + SQL; roll back together on failing integration tests. Keep production and the active BetterQA environment unchanged until explicit approval.
- Connect PR #159's canonical booking columns with draft PRs #160 (atomic extensions) and #163 (verified review eligibility). Test interactions with PR #161 address privacy before merging into a combined QA release branch.
- Run paid Stripe TEST flow for a properly zone-backed Host: booked time, hold, webhook, availability, reminder, My Bookings, Host dashboard, email, extension, cancellation/refund. No Stripe transactions were performed in this draft.

## Acceptance tests
- Toronto 2026-10-20 14:00 ⇒ 18:00Z, Vancouver 14:00 ⇒ 21:00Z, St. John's 14:00 ⇒ 16:30Z; winter offsets and 15-minute increments.
- Device in Greece, Toronto or Vancouver booking the **same** listing ⇒ identical property date/UTC instant.
- Spring DST gap and fall DST repeated hour are rejected, not silently remapped.
- Scheduled hold and confirmed booking `session_range` match the same canonical instant; spot conflict checks and reminder thresholds match.
- Existing paid future reservations are unmodified through migration; verify row/Stripe audit history.
- Explicit rejection when property timezone cannot be verified.
- Existing instant bookings unaffected.

**This is a draft engineering implementation, not a completed live fix. BUG-005156 stays open until BetterQA end-to-end retesting and controlled deployment.**