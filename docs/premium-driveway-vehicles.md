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
