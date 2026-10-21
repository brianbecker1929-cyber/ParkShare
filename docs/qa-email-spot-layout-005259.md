# BUG-005259 — Booking emails use the physical listing layout

The shared email PNG renderer now uses the same physical-bay layout helper as
the booking page, rather than always drawing four bays. Configured spots retain
their physical A-H indexes and private/not-for-rent state. Legacy listings use
their supported 1-8 space count only when no physical configuration exists.

The grid uses one column for a single bay and two columns otherwise, with enough
rows for the real bay count. It draws no extra cell for odd counts. Spot labels,
private-bay text and symbols scale within shorter bays, while the saved vehicle
stays inside the reserved bay. Text labels and accessible image descriptions now
accept E-H as well as A-D. Other rentable bays say “FOR RENT”; the static email
diagram does not claim live occupancy or availability.

Driver and Host confirmations, extension confirmations, halfway reminders and
ending-soon reminders share this renderer. Missing or inconsistent historical
layouts use the existing preview-unavailable text instead of inventing bays or
highlighting a different spot. No historical email or durable retry payload is
rewritten; retests must use fresh bookings/notifications.

## Verification

- Compare the email and application layout for all supported physical counts.
- Render real PNGs for 1, 2, 3, 4, 6 and 8 bays and verify the saved vehicle never
  alters pixels outside its selected physical bay.
- Exercise the real signed-webhook and reminder handlers with isolated fake
  transport for 1-bay A, 4-bay B and 8-bay H bookings. All five email variants
  must carry the expected inline PNG and physical spot label.
- Check all five sample templates with Spot H, bounded selectors and production
  exclusion. No sample preview sends email or reads customer records.

## BetterQA retest

1. Create fresh bookings for listings with 1, 2, 3, 4, 6 and 8 physical bays.
2. Compare Driver and Host confirmation diagrams to the booking page. Verify
   the exact number of bays, private bays, selected A-H label, vehicle and colour.
3. For an eight-bay listing reserve H; ensure it appears in both the diagram and
   the text rather than “Spot not specified”.
4. Extend a booking and trigger both reminder types. Verify the same layout.
5. Check Gmail/Outlook and narrow mobile display for clipped/overlapping text.

Sample-only previews are also available on the isolated BetterQA site:

- `/api/preview-renter-email?spaces=1&spot=A&template=confirmation`
- `/api/preview-renter-email?spaces=3&spot=C&template=extension`
- `/api/preview-renter-email?spaces=8&spot=H&template=halfway`
- `/api/preview-renter-email?spaces=8&spot=H&template=ending`
- `/api/preview-host-email?spaces=8&spot=H`

They use fixed demo data and are marked SAMPLE BOOKING / NO EMAIL SENT. They
remain unavailable on the real production project. No schema migration or
production deployment is included in this repair.
