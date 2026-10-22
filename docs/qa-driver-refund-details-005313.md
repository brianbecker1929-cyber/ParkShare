# BUG-005313 — identifiable Driver refund history and explicit dates

## Cause and repair

Driver spending used exact-location permission to select both the address and
the listing title. Refunded/cancelled reservations no longer have exact-address
access, so their title incorrectly became "Parking session". The date was the
original payment date without a label and formatted in the device time zone.

Keep the listing title in the authenticated renter's own paid transaction
history, independently of exact-address entitlement. A missing/deleted listing
shows "Listing unavailable". Rejected payments remain "Booking not confirmed".
Extensions identify their parent listing unless rejected. No Stripe IDs leave
the endpoint. No public projections or location permissions are expanded.

The Driver card now labels Parking and Paid separately, includes the booking
reference and spot, and uses the stored property time zone for both instants.
The transaction's date and sort remain its original payment instant. The parking
start follows the existing canonical booking-window rules; no booking dates are
rewritten. Invalid schedules are shown as unavailable. Unknown/invalid property
zones explicitly fall back to UTC rather than the browser zone. Extensions show
their payment date, without claiming a second parking reservation. Earned and
payout displays/calculations are unchanged. Refund amounts/status remain visible.

## BetterQA acceptance

1. Use an existing refunded Driver booking or a disposable QA test booking.
   Check Transactions: listing title, Booking #PK reference, spot, original
   charged total, refunded amount and Refunded status must identify the record.
2. For a scheduled booking paid on a different day, compare Parking with the
   reservation start and Paid with the original payment. A refund must not move
   the payment date, replace it with the refund time or duplicate the row.
3. Repeat in Toronto, Athens and Vancouver browser time zones; each booking
   stays in its stored property zone, including dates near UTC midnight/DST.
4. Cancelled/refunded rows must not regain exact street addresses. Another
   account cannot retrieve the original Driver's rows. Signed-out requests fail.
5. Check confirmed/completed bookings, partial refunds, extensions and rejected
   checkout payments; missing listings and invalid legacy schedules must not
   break the history. Legacy missing zones are labelled as UTC/unavailable.
6. Verify mobile wrapping, reload, account switches, and unchanged Host earned
   totals/payout history. No real charge/refund is needed for automated checks.

## Release

Stack on current QA source e7674ddcb4efd1df12c910b516cf3d91de4c11c7 (PR #238).
QA project only: prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC in ESKA Technologies.
No migration, configuration/dependency change, data rewrite or payment mutation.
Rollback redeploys the prior QA source. BetterQA interactive acceptance remains
separate from automated API/component checks.
