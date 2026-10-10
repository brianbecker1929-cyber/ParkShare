# ParkShare approved premium vehicle artwork — production-ready library

## Source artwork

These six transparent WebPs are resized and optimized **from the exact six approved image-generation outputs**, not drawn from a substitute icon set:

| File in repository | Original approved image | Master colour |
| --- | --- | --- |
| `public/vehicles-premium/masters/suv.webp` | `silver_luxury_crossover_top_view.png` | Silver |
| `public/vehicles-premium/masters/coupe.webp` | `top_down_orange_luxury_sports_coupe.png` | Orange |
| `public/vehicles-premium/masters/sedan.webp` | `top_down_metallic_navy_sedan.png` | Blue |
| `public/vehicles-premium/masters/hatchback.webp` | `overhead_yellow_sport_hatchback_cutout.png` | Yellow |
| `public/vehicles-premium/masters/pickup.webp` | `top_down_white_pickup_truck.png` | White |
| `public/vehicles-premium/masters/van.webp` | `top_down_metallic_cargo_van.png` | Grey |

Master images have transparent backgrounds and 390-pixel width (700–753 pixels tall), optimized for the size actually used in driveway diagrams and emails. For future branding at very large sizes, retain the original high-resolution PNGs separately.

## Dynamic booking linkage

- `src/lib/premiumVehicle.js`: derives body type + colour from the **specific vehicle selected for that reservation** (not necessarily the account's primary vehicle). Only six allowlisted body types and named supported colours appear in the URL.
- `api/_premium-vehicle.js`: loads one of the six approved masters; when the renter's colour differs from that image's original paint, recolours painted areas while preserving dark glass, lamps and reflections as closely as possible. The result is a colour-matched *representative* vehicle, **not** an exact model photo or OEM paint calibration.
- `api/vehicle-topdown.js`: public cacheable WebP endpoint with strict known-type and colour validation, allowing reuse in website booking cards and selected spaces.
- `src/App.jsx`: `DrivewayCarVisual` now loads approved artwork in SpotPicker and Driver/Host booking/reservation displays; original layout, labels and highlighted spot remain.
- `api/_driveway-image.js`: composes exactly the same selected vehicle image at full resolution in the booked spot before downsampling the PNG to 500 pixels for **both Renter and Host confirmation emails**. Existing photos, landscape, road, garage, spot labels and reservation status are preserved.

## Preview and testing

Use the feature branch's Vercel preview:
- `/api/preview-premium-vehicles`: six approved images and each one inside the real driveway diagram (synthetic booking data)
- `/api/preview-renter-email`: confirmed renter email with selected vehicle
- `/api/preview-host-email`: host notification with identical selected vehicle
- Driver and Host booking screens on the Vercel deployment

Sample combinations: Silver BMW X4, Orange Lexus LC, Black Honda Civic, White MINI Cooper, Red Ford F-150 and Blue Toyota Sienna.

No database migrations, payment changes, or booking write-side changes. These changes are stacked on PR #123, which is stacked on unmerged email PR #121. **Do not merge into main until explicit approval.**


## Approved 12% scale enhancement (October 10, 2026)

The original six approved transparent WebP masters are unchanged; the **displayed vehicle** is approximately 12% larger on each axis, while its parking bay and the driveway's spot labels remain unchanged.

- SpotPicker / checkout: `83% × 66%` → `93% × 74%`
- Driver and Host booked-space cards: `82% × 67%` → `92% × 75%`
- Compact cards: `80% × 64%` → `90% × 72%`
- Shared confirmation email PNG: `83% × 59%` → `93% × 66%` of the selected spot. Image top moves upward to 19.5% of the bay; selected `SPOT B` label sits at 10% and `RESERVED` at 89% so neither is covered.

The bookable area, reserved outline, car colour/body selection, host/driver booking snapshots and email branding are unchanged. All images still use `object-fit:contain` / Sharp `fit:contain` to avoid distortion and leave a small margin.

See `test/approved-vehicle-scale.test.js` for numeric growth bounds and label-clearance checks.


## Final locked orange Lexus reference footprint (October 10, 2026)

The later approved Spot B orange Lexus screenshot supersedes the earlier incremental 12% sizing experiment. The issue was not image quality; limiting the vehicle to 66% of the parking-bay height (plus hard CSS pixel caps) kept it visibly undersized.

**Final bay-relative placement:**

- Website SpotPicker and checkout selected vehicle: **96% available width / 79% available height**, `object-fit:contain`, no 148px image-width cap.
- Driver and Host full booking cards: **96% available width / 79% available height**, no 129px cap.
- Compact booking cards: **96% available width / 78% available height**, no 78px cap.
- Shared Host/Renter email driveway PNG: **96% bay width / 76% bay height**, centred at 12% below the selected bay top. Actual art's visible footprint is subject to transparent-image aspect ratio, with the coupe expected to occupy about 73–76% of bay height.
- Email selected SPOT label begins 3.5% down the bay, with RESERVED at 91.5%. The image region runs from 12% to 88%, giving clear gap between all three. Unselected bay labels and driveway texture remain unchanged.

The **same six approved WebP masters, vehicle class/colour resolver, booking-selected vehicle snapshot and rendered confirmation image** remain in service. This is a rendering-only scale update, not a data-flow or booking change.

Regression coverage includes the final bay-relative dimensions, no tiny pixel caps, label boundaries and PNG output for all six selected body types (`test/approved-vehicle-scale.test.js`). Review the actual Vercel preview before any merge.


## October 10 visual QA: photo assets were still too small on the website

Actual mobile screenshots showed a **silver BMW X4 in Spot A** with a small visual footprint, while the Renter and Host email previews showed an **orange Lexus LC in Spot B**. These are two different bookings/vehicles, not a mismatch in which car the emails selected.

Root cause: some approved master WebPs contained substantial **transparent padding around the visible vehicle**. The browser's `object-fit:contain` was correctly fitting the *canvas*, but that canvas could contain a visibly smaller vehicle even with 96% × 79% CSS sizing. Further percentage growth alone could not fix it.

Correction: `api/_premium-vehicle.js` now generates a **tight visible-alpha crop** from each approved master (alpha threshold 32), with ~2% artwork margin to protect mirrors/tyres/shadows. The result is cached per body class and reused by the public vehicle URL and the Sharp email diagrams. The original six WebP source files, profile colour mapping and model/body silhouettes are unchanged. Recolouring happens *after* cropping so a silver BMW X4 and blue BMW X4 have identical properly filled bounding boxes.

QA: `test/premium-vehicle-alpha-crop.test.js` asserts the visible car occupies at least 91% of the *image's* width and height for all six body classes and for recoloured variants, while email diagrams remain renderable.

The next preview review should check that the **silver BMW X4 in the Spot A website flow** now appears close to the approved orange Lexus footprint, without overlapping 'Spot A' or 'Your spot'. The website and confirmation email previews are synthetic/review-only. Do not merge until approved.

## Email consistency preview — October 10, 2026

This review supersedes the earlier email-only 500px / 76%-height footprint.
All five active template emails now reuse the same booked-vehicle artwork:
Host new-booking notification, Driver booking confirmation, extension
confirmation, halfway reminder and ending-soon reminder.

- Extension and reminder queries load the immutable booked vehicle snapshot;
  they never substitute today's account primary vehicle.
- All send paths use `deriveEmailSpotStates` with the listing's configured
  `spots`, preventing a private Spot A from appearing available when only B
  is rentable.
- The email PNG is 1000px wide. The approved Booking Ticket layout displays
  it at 180 CSS pixels on desktop and 145 on mobile, alongside vehicle details,
  with its aspect ratio preserved. CID delivery is retained.
- The selected bay uses the website's orange `#E2571C` border and pale green
  fill. Its protected A-D label sits above a 96%-wide / 83%-high vehicle window
  beginning 13% down the bay. No selected-bay footer reduces the car's height.
- Website markup, vehicle masters, colour resolution and email mascots remain
  unchanged. The PNG changes only the shared email diagram.

Preview URLs accept fixed synthetic options:
`/api/preview-host-email?vehicle=silver&spot=A` and
`/api/preview-renter-email?template=confirmation&vehicle=silver&spot=A`.
Driver template options are `confirmation`, `extension`, `halfway`, `ending`;
vehicle options are `silver`, `yellow`, `orange`, `black`, `red`, `blue`;
spot options are `A`–`D`. These endpoints are preview-only and send no email.

Validation exercises the real cron and signed Stripe webhook against a fake
transport, honours database SELECT projections, and compares all five actual
CID attachments with the same saved yellow vehicle in configured Spot B.
No production merge until Brian reviews the previews.

## Approved Booking Ticket layout

Brian approved Booking Ticket for all five email types. A shared table-based
template now keeps the signature logo, compact greeting, status/reference strip,
address, two-column time band, driveway/vehicle ticket and actions consistent.
William introduces the Host notification; Parker introduces the four Driver
emails. Both portraits and the signature logo are inline CID PNGs with generated
hosted fallbacks. The build prepares all three fallback assets.

The ticket includes the saved vehicle make/model/colour and licence plate for
extensions and reminders as well as confirmations. Times and calendar dates use
Toronto local time, including extended departures. Halfway Check-in and Parking
Ending Soon remain distinct; a late cron run inside the final 15 minutes sends
only the ending reminder. Sample previews use 30 minutes at halfway, 15 minutes
at ending soon, and an extension from 8:36 p.m. to 9:36 p.m.

Host and Driver booking confirmations also show the saved full checkout total
(including the service fee) below Toronto local time, matching the extension's
charge row. The Host label is "Total charged to Driver" to distinguish this
amount from Host earnings or payout. Sample confirmations show $5.00 CAD.
