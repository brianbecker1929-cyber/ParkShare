# BUG-005823: property-local endpoints and elapsed parking duration

Brian selected a full time/pricing repair on November 18, 2026. This branch
starts at BetterQA's accepted combined build `e713f60` and keeps its five fixes.

Scheduled bookings resolve both selected wall-clock endpoints independently
in the listing's verified IANA time zone. Their UTC difference is the parking
duration used for preview, Stripe amounts, Checkout metadata, inventory holds
and the paid booking's `hours`. The canonical start plus those elapsed hours
preserves the selected local end in cards, emails, reminders and session ranges.

Checkout independently verifies the selected interval and the requested duration.
A stale/wrong browser quote is rejected before any hold or Stripe Session is
created. Availability checks include both selected endpoints; older duration-only
availability callers retain their explicit elapsed-hours semantics.

The one-hour minimum and quarter-hour increments apply to elapsed parking time.
Missing spring times and repeated autumn times remain invalid endpoints because
they do not identify one UTC instant. The start/end pickers now disable those
choices, including next-day end times. A valid interval may cross the transition.

## BetterQA retest

Use a fresh Toronto test booking for each row. All selected clock times below
are property local time, irrespective of the Driver's browser time zone.

| Selected booking | Expected UTC interval | Billed hours | At CAD $5/hour, before service fee |
| --- | --- | --- | --- |
| March 14, 2027, 1–4 AM | 06:00–08:00 UTC | 2 | $10.00 |
| November 7, 2027, midnight–3 AM | 04:00–08:00 UTC | 4 | $20.00 |
| March 13, 2027, 11 PM–March 14, 4 AM | March 14, 04:00–08:00 UTC | 4 | $20.00 |
| November 6, 2027, 11 PM–November 7, 3 AM | November 7, 03:00–08:00 UTC | 5 | $25.00 |
| Ordinary dates on either side, 9 AM–noon | Property-local 9 AM–noon | 3 | $15.00 |

Check the same selected end and duration in the selection panel, Review & pay,
Stripe Checkout, Driver/Host booking views and confirmation emails. Check that
availability and the reserved interval end at the selected instant. Check missing
March 14 2:00–2:45 AM and repeated November 7 1:00–1:45 AM in both pickers;
manually forged requests for those endpoints must return 400 with no new hold.
An old spring 1–4 AM request claiming three hours must also return 400.

Regression coverage executes the actual checkout/availability handlers and paid
booking construction with synthetic provider/database boundaries, the actual
schedule/payment React controls, email time formatting, halfway/ending reminders
and cancellation at 80, 60 and 59 minutes. It also covers overnight/year rollover,
quarter hours, St. John's half-hour offset, Regina and remote device zones.

## Release scope

No database migration is needed: the existing schema stores canonical UTC starts
and elapsed hours, and holds already contain exact UTC endpoints. Existing paid
bookings are not rewritten or repriced. Book Now and extension durations retain
their existing elapsed-time meaning. The missing/repeated-endpoint restriction
is unchanged server policy and is now also visible in the pickers.

The new review deployment is a separate application using the existing TEST
review environment and shared recovery QA database. BetterQA acceptance remains
pending. The source commit, review URL and completed checks are recorded in the PR.

The branch's non-secret `CLOCK_CHANGE_REVIEW_APP_URL` is evaluated only on this
exact branch in the QA Preview project, pointing to
`https://parkshare-qa-clock-change-review-eska-technologies.vercel.app`.
Its readiness check requires that exact return address, TEST mode and the recovery
backend. Existing environment records, credential scopes and the accepted combined
review's `APP_URL` and return-address binding remain intact. The same resolved
review address is used by payment return links and rendered booking emails.
