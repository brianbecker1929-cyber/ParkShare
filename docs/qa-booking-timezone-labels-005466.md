# BUG-005466: property time-zone labels at booking review

BetterQA's October 30 retest found that property-local clock values were correct but the review screen did not identify whose local time was shown. Review & pay now names the listing's time zone for both scheduled and immediate bookings. Schedule for Later shows the same note beside its time controls. Missing metadata is explicitly identified; no device time zone is substituted.

The existing My Bookings and Host Dashboard use `BookingSchedule` with the saved booking's `timeZoneLabel`; those bindings remain intact. This change adds presentation text only. It does not convert scheduled wall-clock inputs, change the requested interval or alter the payment payload.

## Verification

Three new component regressions fail against the preceding source and pass with this repair. They exercise the real PaymentModal and ListingDetail components, cover a Vancouver listing and missing metadata, and confirm that scheduled values and Book Now's omitted scheduling fields are retained. The focused 98-test run includes Book Now device-zone independence/DST/date rollover, checkout isolation, Driver booking rendering and Host history.

## BetterQA retest

Use the current recovery QA preview in Stripe TEST mode. Keep this ticket Ready for QA until the browser retest is complete.

1. Set the browser to a different zone from a Vancouver listing, such as Toronto or Bucharest.
2. Choose Schedule for Later, a date and 9:00–11:00. Confirm that the controls identify `America/Vancouver local time`.
3. Open Review & pay. Confirm the same local clock values and the `America/Vancouver` note. Switch vehicle and check the note remains.
4. Return and choose Book Now. Confirm the existing arrival/departure previews name the listing zone and Review & pay also identifies it.
5. For an existing paid QA booking, verify the zone label in Driver My Bookings (expanded and collapsed history where applicable) and Host Dashboard. Refresh both pages and confirm their property-local times still agree.

Browser acceptance remains pending. No production release, database/schema change, actual payment or email send is part of this repair.
