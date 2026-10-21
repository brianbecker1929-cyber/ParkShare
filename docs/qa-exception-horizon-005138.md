# BUG-005138 follow-up: special dates limited to 12 calendar months

The original past-date defect passed BetterQA. Brian approved a separate inclusive 12-calendar-month horizon, using the driveway's local date. Both From and To must lie between that date and its calendar anniversary. Leap day clamps to February 28 the following year; this is not a fixed 365-day window.

The shared validator supplies both native calendar maximums, inline errors, Continue/Preview/Publish checks and the publish API's raw-input validation. The API uses its server-derived property timezone before normalization. The existing database trigger also rejects either endpoint beyond the horizon on new or edited availability, preventing direct Data API bypasses.

The migration replaces only `reject_past_listing_exceptions_005138()`. It retains invoker security, the fixed search path, revoked public/client execution privileges and the existing trigger wiring. It does not update listing or booking data. Unchanged legacy availability and unrelated listing edits remain allowed; an availability edit must replace/remove invalid exceptions. Empty exceptions and recurring weekly schedules remain valid.

## Validation and rollout

- Calendar tests cover inclusive endpoints, one day beyond either endpoint, all exception types, year/month ends, leap day, DST, Toronto/Bucharest date differences and malicious browser timezone claims.
- API tests exercise the real `hostListingRow` validator, including malformed dates before normalization can discard them.
- Native PostgreSQL tests apply and reapply the actual migration, check direct inserts, trusted property zones, leap-day parity, legacy-row preservation and client execution privileges.
- The full captured-schema rehearsal also checks authenticated owning-Host writes at the cutoff and denial beyond it under the real policies.
- Initial QA preflight found 17 listings and no existing exceptions beyond the horizon. No customer data is copied into tests.
- Run native CI/rehearsal before applying `20261021200109_exception_horizon_005138.sql` to the isolated BetterQA database. Deploy the paired UI/API afterward. Production is outside this rollout.
- Rollback, if required, restores the previous function body from the base commit; there is no data rewrite to undo.

## BetterQA retest

In Special dates & exceptions, verify both calendars permit today through the displayed maximum and disable dates after it. A range whose end crosses the limit, a wholly later range and year 2100 must be rejected, including typed/direct-save attempts. Continue, Preview and Publish must remain blocked for invalid ranges. Check a valid range spanning New Year, the exact cutoff and the original past/reversed-date protection on desktop/mobile. The cutoff must follow the property's timezone when the Host is travelling. Existing weekly availability and normal listing edits should continue working.

This is the approved maximum-range follow-up; the original BUG-005138 past-date result remains passed. BetterQA's interactive UI retest remains pending after deployment.
