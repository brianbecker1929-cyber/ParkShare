# BUG-005490 — warn before choosing an unbookable Host listing

Recovery QA / Stripe TEST only. The screenshots show a Driver selecting a bay
and vehicle before receiving the incomplete-Host-payout rejection at payment.
Search now marks incomplete Host setup and unknown booking status. Details run
a server-owned readiness check before opening spot selection or payment.

## Behavior and boundaries

- Public browse adds only `bookingStatus: ready | not_ready | unknown`. One
  bounded secondary database lookup covers the existing maximum 50-row page.
  The existing approximate-location projection and keyset cursor are retained.
  Linked account IDs, Host identity and verification requirements stay private.
- Browse is advisory: its stored webhook flags share the existing 60-second
  cache / 120-second stale-while-revalidate window. View parking remains usable
  to open details and check current status, including recently completed Hosts.
- `GET /api/listing-bookability?listingId=N` resolves the Host on the server and
  reads Stripe Accounts V1. All three existing checkout prerequisites must be
  true: details_submitted, charges_enabled, payouts_enabled. No linked account
  or non-Host profile is not ready; provider/database uncertainty returns 503
  with unknown. Only a status enum is exposed. All replies are no-store.
- Stripe reads are coalesced per account in a bounded 128-entry process cache
  for 10 seconds. Errors are not cached. This endpoint does not create accounts,
  send emails, take payments or modify provider/database state.
- Details start checking. Until ready, an early notice replaces green availability
  claims, Choose spot and Reserve & pay are disabled, and neither picker nor
  payment can open. Unknown and incomplete states offer Check again. Refresh on
  focus/visibility rechecks readiness; refreshing pauses during payment. Listing
  switches, aborts, retries and superseded responses cannot approve another scope.
- Availability, Host opening hours, bay identity and vehicle validation still apply
  independently after readiness passes. A loss of readiness closes payment.
  Demo listings preserve their existing behavior without provider requests.
- This is a point-in-time UX check. Existing create-checkout-session and extension
  handlers still independently retrieve Stripe status and block incomplete Hosts.
  That final race-safe server gate is unchanged; no browser flag authorizes money.

## Validation

Tests exercise the actual endpoint, public helper/projection, provider cache,
async hook lifecycle, actual ListingDetail and BrowseView, plus existing spot,
vehicle, privacy and checkout regressions. Cases cover all missing/false flags,
HTTP/network/malformed failures, retry, TTL/eviction/coalescing, A-B-A navigation,
late replies, abort/unmount, focus/pause, disabled actions and readiness loss.
Build retains the deferred password dictionary and initial bundle budget.

Read-only recovery data identified listings 2 and 31 with incomplete payout flags;
no schema changes or real account/payment mutations were needed. Browser automation
was unavailable; interactive acceptance remains with BetterQA.

## BetterQA retest

1. On desktop and 390×844, browse the reported incomplete Host listing. Confirm
   the warning is visible before opening it. In details, confirm the early Host
   setup notice, no green bookable claim, disabled Choose spot/Reserve & pay and
   no payment modal. Repeat signed out and as a Driver with a saved vehicle.
2. Open a ready Host listing. Wait for readiness and availability, select a valid
   bay/vehicle and reach Stripe TEST checkout. Confirm existing duration, schedule,
   physical-bay and vehicle rules still apply. Do not complete a live payment.
3. In controlled TEST fixtures, complete Host setup, wait beyond the 10-second
   provider cache and use Check again/focus. Confirm readiness enables selection;
   browse may refresh later because its stored flags/cache are advisory.
4. Fail or throttle the readiness request. Controls remain disabled with retry,
   never a false green status. Navigate A-B-A and resolve responses out of order.
5. Change readiness after details open. A focus recheck must block the page; if
   status changes while payment is already open, the existing final checkout
   guard must still reject it. Keep this check in TEST.
6. Check privacy: public response contains only coarse listing fields and enum;
   readiness response must never reveal account IDs or verification requirements.
   Email quota/delivery is independent of this repair.

Reference: https://docs.stripe.com/api/accounts/object
