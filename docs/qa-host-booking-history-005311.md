# BUG-005311 — retained Host booking history

Cancelled bookings correctly leave Upcoming, but the Host dashboard previously rendered no history view for the retained booking rows. Hosts can now switch between Upcoming and Booking history in the same card. History shows recent completed/cancelled reservations with their reservation reference, Driver, listing, booked spot, vehicle, original property-local schedule and original booking total in CAD. A Transactions shortcut provides the separate charge/refund record; the booking total is not presented as net earnings or a refund amount.

Host cancellation moves a confirmed cancellation immediately into history. Cancellation pending stays in Upcoming until the server confirms the terminal status. Refresh bookings reloads the existing authenticated Host dashboard endpoint, including Driver-initiated cancellations, without losing the selected view. Current reservations remain in Upcoming and its statistic; time-based completion moves ended reservations into history. Each view starts with three rows and supports expansion. Controls wrap and have 44px minimum touch targets.

The existing API already returns these records, scoped to listings owned by the JWT principal. Its authorization, privacy projections and 500-booking/250-listing limits are unchanged. This is recent loaded history, not a new lifetime archive/pagination feature. No database migration, refund/payment mutation, public endpoint or account permission change is involved. Existing account-keyed dashboard remounting and aborted-load guards protect both views.

## Verification and BetterQA retest

The regression exercises the actual dashboard load, controls and cancellation callback: a cancelled future booking remains findable, retained metadata/time/amount are correct, pending vs terminal cancellation stays distinct, completion follows the clock, loading/errors hide stale cards, expansion resets between views, and the Upcoming statistic returns to the correct view. Existing account-isolation and canonical-cancellation tests remain part of the release checks.

On desktop and mobile, cancel a future booking first as the Driver, then as the Host. On the Host dashboard use Refresh bookings after an external cancellation. Confirm each cancellation leaves Upcoming and its count, appears in Booking history as Cancelled, remains after reload, retains its reservation/spot/vehicle/local schedule and has no cancel action. Follow the Transactions link to check the separate refund record. Pending cancellations must stay pending in Upcoming. Check completed bookings, more than three history rows, empty history and normal active/future reservations. BetterQA interactive acceptance is pending deployment/retest; automated checks do not claim a live paid booking was cancelled.

Deploy only to parkshare-qa.vercel.app after tests/build pass, retaining the earlier QA repairs. Rollback redeploys the prior QA source commit; no data changes need undoing.
