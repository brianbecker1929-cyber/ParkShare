# BUG-005156 — Scheduled booking timezone remediation

**Status: not fixed or deployed.** The pure helper and its five passing tests are a proposal only. It is **not imported into live checkout, availability, emails or the database**.

## Reproduced mismatch

- Driver selects a local calendar date and fractional start hour.
- Current api/_booking-rules.js#getSessionWindow() constructs that local hour as UTC.
- Checkout and listing-availability use this same incorrect instant for holds and Host schedules.
- QA's PostgreSQL session-range trigger also interprets the chosen clock hour as UTC, based on the read-only investigation recorded in issue #158.
- Booking email formatter renders the result in America/Toronto, irrespective of the property's time zone.
- At a Toronto property on October 20, 2026, 2:00 p.m. local is 18:00Z, not 14:00Z. At Vancouver, it is 21:00Z.

## Proposed consistent contract (product and BetterQA review required)

1. Resolve and persist each listing's authoritative IANA property timezone server-side based on its location. Validate and backfill existing listings before rollout; do not trust the browser's timezone.
2. Submit the literal YYYY-MM-DD property calendar date and selected fractional hour; do not turn the chosen date into a browser-dependent ISO UTC date.
3. Checkout and availability use the same validated wall-clock-to-UTC resolver and the property's timezone. Explicitly reject daylight-saving nonexistent and ambiguous times unless an approved disambiguation interface is provided.
4. Persist immutable UTC starts_at, ends_at and an IANA property-timezone snapshot on each booking/hold. Calculate elapsed-hour duration from the canonical UTC start; keep chosen local labels for display.
5. Postgres exclusion/session-range computation, holds, Stripe metadata, payment webhook, emails, Host/Driver views, reminders and extensions must all use the canonical approved instants. The server-registered hold, not untrusted Stripe metadata, is authoritative.
6. Show all reservation communications in the property's local timezone (with zone identifier where useful), not a fixed Toronto setting.

## Historical bookings and release gate

- First perform a read-only inventory of paid scheduled reservations, active holds, Stripe Checkout IDs, booking_date/start_hour, UTC session_range, property coordinates/timezone and potential conflicts.
- **Never automatically change historic paid reservation instants**, send refunds or replay webhooks. Review individual conflicts and required customer/Host notices before remediation.
- Coordinate an atomic, versioned API and SQL migration in a BetterQA-approved maintenance/retest window. Do not independently change either layer, and avoid changes to the QA environment while testing is active.
- Do not merge this helper as a functioning fix. Existing scheduled booking behavior is still a launch blocker until the end-to-end change has been implemented and retested.

## Minimum BetterQA acceptance tests

- Toronto: October 20, 2026, 14:00 = 18:00Z; January 20, 2026, 14:00 = 19:00Z.
- Vancouver: October 20, 2026, 14:00 = 21:00Z; Newfoundland = 16:30Z.
- Browsers in Toronto, Greece and Vancouver booking the same property resolve to identical UTC instant and local calendar date.
- Check midnight/23:45 starts, exact quarter-hour durations, spring-forward gap (March 8, 2026 02:30 Toronto), and fall-back repeated hour (November 1, 2026 01:30 Toronto).
- Check consistent availability and spot holds, Checkout, Stripe session metadata, Host/Driver dashboards, payment success email and reminders, including cancellation, refund and extension.

Tracked investigation: https://github.com/brianbecker1929-cyber/ParkShare/issues/158
