# Booking regression repairs and Vancouver retest — November 16, 2026

The correct BugBoard account now exposes PARK and the complete reports for
BUG-005674 through BUG-005678. This branch starts from frozen QA commit
`072629e16b35970bcae1260ab2e5660ece2b08d8` and proposes frontend repairs only.

## Prepared repairs

| Ticket | Cause and proposed behavior |
| --- | --- |
| BUG-005675 | The Book Now panel and Review & pay lacked a cancellation disclosure. Both now explain that parking starts immediately after payment, cannot be cancelled in the app, and requires support review for a refund request. Scheduled-booking copy is unaffected. |
| BUG-005676 | `ListingDetail` supplied `disabled`, but the shared `Btn` removed its click handler without setting the native button attribute. Disabled actions now expose native disabled semantics, including Reserve & pay for invalid durations. Existing validation and server limits remain intact. |
| BUG-005677 | An open cancellation dialog could retain refund copy until the next parent render. It now schedules its own refresh just after the inclusive cutoff, refreshes on focus/visibility changes, and uses the required Driver notice. Pending requests retain their checking state. Timers/listeners are cleaned up; long deadlines avoid timer overflow. |

The disabled-control and idle-dialog regressions fail against the original
frozen source and pass against the repair. The deadline checks also exercise
the exact boundary, focus after background throttling, long deadlines,
cleanup and a pending response.

## BUG-005674: retest against current Vancouver rules

The ticket assumes Vancouver reverted to UTC-8 on November 1, 2026. B.C.'s
current rule and IANA release 2026b both specify permanent UTC-7. The booking
converter uses `Intl` with the property's IANA zone, rather than a hard-coded
Vancouver offset. The cancellation policy uses the saved canonical instant.

References checked November 16:

- [B.C. announcement](https://news.gov.bc.ca/releases/2026AG0013-000209)
- [B.C. Pacific Time naming and November transition](https://news.gov.bc.ca/releases/2026CITZ0009-001073)
- [IANA 2026b release notes](https://www.iana.org/time-zones/releases/2026b)

| Reported selection | Correct UTC start under the current rule | Driver automatic-refund cutoff |
| --- | --- | --- |
| PK-159: November 12, 10:00 Vancouver | November 12, 17:00Z | November 12, 16:00Z |
| PK-158: November 22, 16:00 Vancouver | November 22, 23:00Z | November 22, 22:00Z |

New offline checks exercise the actual converter, canonical session window and
cancellation evaluator at 80, 61, 60, 59 and 20 minutes of notice for both
reported selections and the ticket's November 22 10:00 example. They pass on
Node 24.22.1 with current timezone data. No stored booking was changed.

For PK-159, 80 minutes of notice is 15:40Z, which is 08:40 Vancouver under
the current rule. A request at 16:40Z has 20 minutes of notice, and a late
refusal is expected. The report's observation window was 16:20–16:50Z.
BetterQA has now confirmed the request occurred at approximately 16:40Z,
09:40 Vancouver, with 20 minutes of notice. The refusal was correct. Their
earlier UTC-8 assumption came from older browser timezone data.

BetterQA retest:

1. Record the browser/OS versions and timezone-data result for this public,
   credential-free check:

   ```js
   new Intl.DateTimeFormat('en-CA', {
     timeZone: 'America/Vancouver', dateStyle: 'full', timeStyle: 'long'
   }).format(new Date('2026-11-12T17:00:00Z'))
   ```

   The local hour must be 10:00. A 09:00 result indicates older timezone data.
2. Verify each booking's UTC instant, displayed property-local selection and
   exact cancellation request timestamp. Repeat the true 80-, 60- and
   59-minute boundaries in an isolated TEST fixture.
3. Compare current and older browser timezone data. Any client/server display
   disagreement remains a separate compatibility finding to investigate.

BetterQA acknowledged BUG-005674 as not a bug and stated that they will close
it and remove the Vancouver blocker from the readiness report. Their review
retest will still cover 80-, 60- and 59-minute cancellation boundaries using
current timezone data and exact UTC request/response evidence. No stored
booking time or cancellation policy has been changed. Older-browser display
compatibility is a separate follow-up; see the combined review handoff.

## BUG-005678: outstanding product decision

The ticket explicitly labels the declined-card hold as a product decision.
Releasing a bay while the original checkout can still accept payment needs a
coordinated session-expiry and reconciliation design. This draft leaves that
behavior unchanged; shortening or ending the payment-retry window requires a
separate decision and financial-flow verification.

## Release and retest boundary

This work is a separate draft. Production, the frozen QA branch, hosted
databases, Stripe settings, reminders and emergency-alert activation are not
modified. No payment, refund, transfer or webhook replay was performed.
BetterQA's verification of all prepared repairs remains pending, on a separately
configured review target or a later coordinated release.
