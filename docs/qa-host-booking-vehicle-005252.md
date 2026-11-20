# BUG-005252 — Hosts can save a vehicle while reserving

Hosts could reserve another Host's space, but checkout required saved vehicle
metadata and the only vehicle editor was on the Driver-only profile page.
The booking picker now includes an inline primary-vehicle form for signed-in
Hosts and Drivers. A person with no complete vehicle sees the form after
choosing a spot; existing renters can add or edit their primary vehicle there.

All four fields (make, model, colour and plate) are required. The existing
vehicle dropdowns, validation choices and realistic vehicle renderer are
reused. Saving keeps the listing, bay and Park Now/future schedule in place,
selects the saved primary vehicle and enables confirmation. Cancelling the
editor preserves an existing vehicle. Narrow screens use a single-column form.

`PATCH /api/booking-vehicle` verifies the signed-in user and database-owned
Host/Driver role. It accepts only the four vehicle fields, normalizes the plate,
and patches only the corresponding Auth metadata plus the derived description.
It never accepts another user ID or changes account roles, names, phone numbers
or guest vehicles. Supabase Auth merges the partial metadata patch, avoiding a
stale full-profile overwrite. The existing Driver-only `/profile` UI and API
remain protected, including the BUG-005169 repair. Hosts still cannot book
an owned listing; the existing checkout guard is retained.

The UI captures the original account and form payload, suppresses duplicate
submits, checks session ownership before writing, and confirms refreshed vehicle
metadata before publishing success. Closing the picker, signing out or changing
accounts invalidates pending work. A saved vehicle with an unconfirmed refresh
is reported explicitly so it cannot silently enter checkout with stale data.

No schema migration is required. No payment, Stripe or historical booking
records are changed by the deployment.

## Verification

Automated tests exercise both API roles, required fields and invalid choices,
allowlisted metadata, forged IDs/roles, role lookup errors, failed Auth saves,
account changes, unmounts, refresh failures, concurrent submits and canonical
responses. Tests execute the compiled React form and real save helper, and
exercise the listing picker through Host vehicle save into payment for Park
Now and Schedule for Later, retaining the exact bay and scheduled window.
Existing Driver profile and role-gate regressions remain part of the suite.

## BetterQA retest

On https://parkshare-qa.vercel.app:

1. Sign in as a Host with no saved vehicle. Open another Host's listing, choose
   a spot, and add make, model, colour and plate within Choose your spot.
2. Save. Verify the realistic vehicle preview and selected primary vehicle,
   then confirm the spot and continue to Stripe test checkout. The listing,
   bay, duration and scheduled times must remain unchanged.
3. Repeat for Park Now and Schedule for Later. Finish a test booking and check
   the saved vehicle/plate in its confirmation. Re-sign in and verify the
   vehicle is still available for the next booking.
4. Check required-field errors and cancellation of the editor. Repeat with an
   existing Driver primary/guest vehicle to verify normal selection still works.
5. Confirm the account retains Host access to its dashboard and listings. A
   Host opening `/profile` must still be directed to the proper Host flow, and
   the Host's own listing must remain unbookable by that same account.

Live authenticated Host booking/Stripe acceptance remains for BetterQA after
the deployed smoke checks. Production is not part of this QA release.
