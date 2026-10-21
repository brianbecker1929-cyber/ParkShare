# BUG-005258 — Host onboarding from List Your Space

Clicking any List Your Space CTA on /hosts now opens explicit Host onboarding
for a signed-in Driver instead of redirecting to /parking. Existing Hosts go
straight to /list-your-driveway. Signed-out visitors begin signup.

ParkShare retains its existing separate Host/Driver account model. The dialog
explains that a new Host account needs a different email address, preserves the
Driver account and bookings, and offers either Host signup or Host sign-in.
Signing out occurs only after an explicit click and uses Supabase local scope.
Errors remain visible, duplicate clicks are locked, and stale or changed-account
work cannot advance onboarding. Cancel leaves the Driver signed in on /hosts.

Host signup retains an explicit Host role choice and mandatory legal consent.
Authenticated database roles still control listing creation. No role conversion,
database migration, or production deployment is included.

## BetterQA retest

1. As a Driver, open /hosts and click each List Your Space CTA. Expect the Host
   onboarding dialog and no redirect to /parking.
2. Choose Stay on this page or Escape. Confirm the Driver remains signed in.
3. Choose Sign out & create Host account. Expect signup. Register with a new
   email, choose List my driveway, and accept the disclaimer. Complete email
   verification if required, then sign in from /hosts. Expect the listing form.
4. Choose Sign out & sign in as Host with an existing approved Host. Expect
   /list-your-driveway. Signing back in as a Driver returns to the onboarding
   explanation and does not grant Host permissions.
5. As an existing Host, click List Your Space. Expect the listing form directly.
6. As a signed-out visitor, click the CTA. Expect Host signup. Check mobile
   wrapping, keyboard navigation, dialog Escape/cancel, and visible error states.

Automated regression covers CTA destinations, the post-auth destination, cancel,
both explicit account handoffs, local sign-out, failures, duplicate clicks,
unmounts, and cross-account stale work. Full authenticated browser acceptance
and email verification remain BetterQA retests.
