# BUG-005269: abandoned initial Checkout and parking holds

QA-only change stacked directly on PR #220, commit 4dab261f6d8ab951cf6b95b3c8ef257ddf805141. PR #221 is deliberately excluded: its required migration is not installed. No schema migration is required here.

## Behavior

Starting Checkout keeps the existing 30-minute exclusive inventory hold. It does not create a paid booking. Availability now distinguishes `held`, `booked` and `available` while retaining the boolean `spotStatus` API. The spot picker calls an unpaid hold “Checkout in progress,” explains its duration, and does not render a previously selected vehicle on an unavailable bay. Both the available-now title and selected-window check refresh every 15 seconds while visible, on focus/visibility return and after verified cancellation. Older responses cannot overwrite newer ones; checks stop on disposal. Selected-window refresh pauses while the payment dialog is open.

New initial-booking Stripe cancel URLs include the UUID of the server-owned hold. Returning through that link invokes an authenticated cancellation handler after session hydration. The reference is not authorization: the handler queries only the authenticated renter's hold, verifies the trusted registration, excludes booking/extension registrations, retrieves the session on its stored connected account, and checks session identity, mode, currency, amount and unpaid state. An open session must expire successfully at Stripe. A second provider read must confirm expired/unpaid state and matching livemode before a conditional deletion of that exact owner/session/account hold. Provider or database failure never claims release. No booking, payment, refund or extension is created or modified. Duplicate requests and signed expiry webhook cleanup may safely converge on an already-absent hold.

Missing/other-account references return the same unconfirmed `not_found` result. The client never infers payment success or absence of charges from URL flags or missing holds. Signed-out users are told to sign in; errors allow an explicit retry. Obsolete auth/HTTP replies cannot update a disposed cancellation view. Public availability exposes state labels, not hold/session/account/renter identifiers. Availability and cancellation responses use no-store.

Closing the Stripe tab or pressing browser Back without the Stripe cancel-return link retains the existing bounded hold until its 30-minute expiry. Inventory queries ignore expired holds even if the signed expiry webhook is delayed or never delivered. This repair does not remove all holds as soon as a browser closes: the browser cannot safely establish whether payment completed. Old sessions created before deployment retain their old cancel URL and still expire normally. No historical hold deletion/backfill is performed.

## Verification

Actual handler tests intercept synthetic Supabase HTTP transports and Stripe calls: correct owner and connected account, conditional release, unauthenticated/cross-account/invalid requests, paid/complete/async pending and mismatched sessions, payment-versus-expiry race, invalid registration, provider/read/delete failure, replay, separate future windows, wall-clock expiry without webhook cleanup, and preservation of paid bookings. Public endpoint output distinguishes states without exposing identifiers. Actual compiled React/effect tests cover cancellation acknowledgment, session mismatch/disposal, failed acknowledgments, expiry refresh, payment/background pause, focus/cancel refresh, stale responses, timer/listener cleanup and actual bay markup. The old bay markup fails the held-state regression.

Native CI/build and live deployment verification results are recorded in the PR. Synthetic tests do not establish real Stripe/browser acceptance.

## BetterQA retest

Use fresh Stripe TEST checkouts on https://parkshare-qa.vercel.app.

1. Start an initial checkout and inspect the same window from a second Driver. The bay is temporarily held, labelled “Checkout in progress”; it is not a paid booking. A competing checkout cannot take the held bay.
2. Use Stripe's cancel/back-to-ParkShare link while signed in. Wait for the verified hold-release message. The bay becomes available without waiting 30 minutes, unless another booking/hold legitimately occupies it.
3. Repeat while signed out, then sign in as the original Driver. Another account must not release the original Driver's hold.
4. Close Stripe or use browser Back without its cancel link. The hold may remain until 30 minutes from checkout creation; then an already-open visible picker/title must refresh within 15 seconds. No webhook delivery or manual page reload is necessary for inventory expiry.
5. Complete a separate valid payment. Its bay must remain booked, including after opening an old cancel URL or reaching an abandoned hold's expiry. Verify My Bookings and Host bookings, normal confirmation email and unchanged charge.
6. Repeat for scheduled parking, another time window and a failed cancellation/retry. Existing double-booking safeguards and PR #220 extension behavior must remain intact.

Keep the ticket awaiting BetterQA retest until real-browser and Stripe TEST acceptance passes. Production/main are outside this release.
