# BUG-005467: closed-hour guidance

The earlier repair distinguished a closed Host schedule from occupied spaces. This follow-up completes the requested guidance: the public availability response now includes a short schedule hint for the property's local date at the requested start. The booking warning and spot picker display it through their existing shared message function. Book Now directs the Driver to the existing Schedule for Later control.

The hint uses the same property zone, weekly rule and last matching date exception as availability enforcement. It identifies all-day availability or a day-specific closure where applicable. A hint describes Host hours for its named date; it does not promise free bays or that the whole requested duration fits. Missing/invalid property zones omit the hint rather than substituting a device zone. Paused listings retain their separate pause message.

Only the short text is returned. Other exception dates, names, addresses, booking details and the full schedule are not added to the response. No schema, stored schedule or booking/payment changes are needed.

## Verification

The 79 focused checks cover the actual API response and real booking warning/picker components, property-date rollover, an unrelated stored schedule zone, regular hours, custom exceptions, closure priority, all-day exceptions, invalid metadata, open capacity and unavailable bay selection. Two API regression cases fail against the preceding source. Existing checkout-hold, listing settings and property-zone enforcement checks pass.

## BetterQA retest

1. Use the recovery QA site in Stripe TEST mode. Open a Toronto listing with Evenings availability while it is outside 5pm–11pm Toronto time.
2. Check Book Now and Choose your spot. Both should explain the closed hours, show the dated 5pm–11pm schedule with `America/Toronto local time`, and avoid saying that spots are taken.
3. Use Schedule for Later to choose an eligible future period. Require a fresh availability check before a bay or checkout becomes available.
4. Repeat for an existing custom-hours exception and a closure exception. Confirm the message uses that date's exception rather than the weekly preset. Check a browser zone different from the property's and a date crossing UTC midnight.
5. Compare genuinely occupied open hours and a paused listing. Their existing occupancy and pause messages should remain distinct.

Browser/visual acceptance remains pending. No real payment, email send, production release or database mutation is part of this repair.
