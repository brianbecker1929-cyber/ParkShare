# Premium dynamically rendered vehicles in ParkShare

Implementation: shared `src/lib/drivewayCar.js` is used by the Driver spot selector, payment review, Driver My Bookings, Host Upcoming Bookings, and server `api/_driveway-image.js` for both booking emails. **One renderer**, no separate hard-coded car illustration per channel.

## Vehicle selection and source of truth
- During checkout, driver selects one of the saved vehicles. Booking snapshot stores its make, model, colour and plate.
- All confirmed-booking views use this snapshot (`b.vehicle` or booking fields) and do not silently substitute the account's current primary vehicle.
- The server email renderer draws from the same booked snapshot, so later profile edits cannot retroactively change a confirmed reservation.

## Visual implementation
Six deterministic vector body classes: sedan, crossover/SUV, coupe, hatchback, pickup truck, van. The renderer changes front/rear window geometry, wheel and body proportions, cab/roof, cargo bed and reflective surfaces by body class. A normalized approved colour map avoids inserting arbitrary profile text into SVG. Unknown models/colours have a neutral fallback; no real brand badge or exact factory-specific likeness is claimed. These are premium *representative* body-class vehicles, not photorealistic depictions of every unique make/model.

The SVG viewbox is 96×188 and reusable in browser and email rendering. Vehicle size is increased in all selected bay components without hiding Spot A/B/C/D labels or RESERVED status. Both email notifications use Sharp to rasterize the same shapes into attached PNGs; the live app uses the SVG data URL.

## QA samples
- Silver BMW X4 → silver crossover/SUV
- Orange Lexus LC → orange sports coupe
- Black Honda Civic → black sedan
- White MINI Cooper → white hatchback
- Red Ford F-150 → red pickup
- Blue Toyota Sienna → blue van

Preview-only six-car gallery: `/api/preview-premium-vehicles` (no charges, emails or private customer data). To compare in booking emails, use existing `/api/preview-host-email` and `/api/preview-renter-email` routes, which also use the updated email image renderer.

Changes are stacked on PR #121's Host/Renter email work, so PR #121 must be merged or integrated first. Never merge directly to `main` without UI approval.
