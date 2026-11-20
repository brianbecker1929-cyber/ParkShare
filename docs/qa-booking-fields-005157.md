# BUG-005157: booking payload, vehicle body class and confirmation acceptance

The payload repair had passed BetterQA's October 28 retest at 1,154 bytes for one booking. The remaining failures were real: `vehicle_type` copied the primary/guest profile role, and accepted Driver confirmations never populated `confirmation_email_sent_at`.

## Repair

- Primary and guest Driver profile editors, plus the shared Host/Driver booking-only editor, now offer a labeled vehicle-type selector: sedan, SUV/crossover, coupe/sports car, hatchback, pickup or van/minivan. The selected value survives private Auth save and refresh.
- `vehicle_id` / `vehicle_profile_id` continues identifying the selected saved vehicle. `vehicle_type` now carries its saved body class through both Stripe Session and PaymentIntent metadata, the server-owned hold snapshot and paid settlement. Request-supplied vehicle details cannot override the saved selection. Booking artwork respects the explicit body class.
- Type is optional for compatibility with existing profiles. An unspecified type stays empty in Stripe metadata and NULL in a new booking; the application does not guess a class. Legacy in-flight role metadata is normalized to NULL when settling. Historical booking/Stripe records are preserved, including their old primary/guest values; use a NEW Checkout session after saving a type to verify the repair.
- The Driver confirmation reads its existing acceptance timestamp before sending, uses a stable project/booking/Driver provider key, and writes `confirmation_email_sent_at` only after a non-skipped provider response contains an acceptance ID. The update is scoped to the booking and renter and cannot replace an existing timestamp. Read/write failures are surfaced in notification logs. The separate Host notification cannot set or clear this Driver timestamp.
- The timestamp records provider acceptance, not inbox delivery. Failed/skipped attempts remain NULL. This change does not introduce an automatic retry worker or resend historical messages. If the provider accepts a message but its database write fails, reconcile the provider result before retrying; no historical timestamps are fabricated.
- My Bookings keeps its private field projection. Only the small body-type value is added; images, payment-provider IDs and email delivery internals stay excluded. A five-booking regression with a synthetic 2 MB listing image remains under 15 KB and private/no-store.

## Database and validation

Recovery QA migration `20261101225651_qa_booking_vehicle_type_005157.sql` widens the existing constraint to admit the six body classes plus historical role values and NULL. It changes no grants, policies or booking data. Applied only to `heqxirlsorcztsawaldg`; a before/after digest confirmed all 115 booking rows unchanged, with zero historical confirmation timestamps invented. Existing security advisory counts were unchanged.

The disposable schema probe applies the migration twice, verifies history preservation, accepts all six classes independently of the profile ID, rejects an unknown body class and keeps a new booking's email timestamp NULL. Native PostgreSQL CI repeats the probe with the complete schema.

114 focused checks cover the actual vehicle controls, profile save/refresh, booking-only save, actual Checkout registration, paid settlement, payload projection, provider-key forwarding and the webhook's separate Driver/Host email paths. Seven new integration assertions fail against pre-repair commit `f0af1ef` for the missing selector/session field, old Checkout mapping and absent confirmation timestamp. The full local suite passed 1,662 tests with two database skips; two subsequently added regressions also passed. The build passed. Final CI/deployment receipts are recorded in draft PR #252 and BugBoard.

## BetterQA retest (recovery QA and Stripe TEST)

1. On desktop and 390 × 844, save a primary vehicle with a body type. Refresh/sign out and back in; verify it persists. Repeat for a guest vehicle with a different type. A Host booking someone else's listing should also be able to save a primary body type in the booking editor.
2. Create a NEW Stripe TEST Checkout session for each selected vehicle. Verify Session and PaymentIntent metadata use the chosen class (`sedan`, `suv`, etc.) while `vehicle_id` remains `primary` or the guest ID. Old sessions retain their old metadata and are not a valid retest.
3. Complete one QA test payment. Verify the booking still confirms, retains the same body class and vehicle profile ID, appears on both dashboards, and uses the selected artwork. Later profile edits must not change the booking snapshot.
4. Verify the Driver confirmation is accepted by Resend and received, then read that booking's `confirmation_email_sent_at` in recovery QA. It must be populated after acceptance. The Host receives their separate private notification. Redelivering the same paid webhook must not create another booking or email.
5. In a controlled failure fixture, a Driver provider failure/skipped send must leave its timestamp NULL even if the Host email succeeds. A Host-only failure must not remove a successful Driver timestamp. These failure paths are covered automatically without sending real messages.
6. An existing vehicle without a saved type remains usable and creates no invented body class. Save a type before expecting a non-NULL value. Review historical records as legacy data rather than rewriting their classification or acceptance times.
7. Inspect My Bookings' response: it should remain a few KB per booking with no embedded image/base64 content or email internals and `Cache-Control: private, no-store`.

Manual browser and real provider/payment acceptance remain pending BetterQA retest. Automated checks use synthetic services and disposable data; no real booking, charge, refund or email was triggered for this repair. Keep PR #252 draft/unmerged and production unchanged.
