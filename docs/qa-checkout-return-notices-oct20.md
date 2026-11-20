# QA follow-up: truthful checkout and payout return notices

Code-identified financial UI correctness defect; no BetterQA ticket ID assigned. QA only, stacked on PR #200 and all prior repairs. No main merge or actual production promotion.

## Defect and repair

Manually adding booking_success, extension_success or stripe_onboarding=return to a URL showed payment-received/booking-confirmed, additional-time-purchased or Stripe-connected claims without any server evidence. Cancellation flags claimed no charge was made; a refresh flag claimed the setup link had expired. These navigation hints cannot establish settlement, webhook fulfilment, absence of a charge or payout readiness. A genuine checkout return can also precede asynchronous booking fulfilment.

All six return cases now render a neutral, accessible status notice. Booking/extension notices point to saved booking/end-time and transaction state, advise checking Transactions before another payment, and offer fixed internal links. Payout notices point to the authenticated Host Dashboard's current status. Refresh bookings / Refresh payout status are ordinary full-navigation links, so they perform a fresh load rather than leaving the existing view's one-time fetch in place. Every notice has a labelled dismiss button. No success colour, checkmark or celebration implies confirmation from an unverified flag.

Existing destinations, query cleanup and message/reservation/extension email-link routing remain intact. Unknown notice kinds render nothing. URL values, session IDs and booking IDs are not copied into notice HTML or action URLs. An edited URL may display guidance, but cannot create a financial outcome or cause a payment/setup request.

This is an accuracy repair, not checkout-session reconciliation: it makes no Stripe verification call, introduces no polling and does not automatically associate an extension return with a new ledger row. Actual status continues to come from authenticated bookings/transactions/payout views. Delayed fulfilment requires an explicit refresh. Backend checkout/webhook validation, holds, calculations and historical records are unchanged. Demo checkout presentation and independent account-scoping of extension/navigation overlays are outside scope. No migration or dependency change.

## Verification

`test/qa-checkout-return-notices.test.js` executes the actual root URL effect, compiles the actual root notice JSX and new component, and renders HTML. Twelve checks cover all six genuine/forged return types, false/zero/conflicting flags, unknown/prototype-like notice kinds, absence of false financial/expiry claims, fixed internal refresh/history links, dismissal, retry-payment guidance, query/session-ID removal and message/reservation/extension email routing. Six primary cases fail on the previous source 016688dfd10278b1cde99bde153b01e3584c1659. All focused checks pass with the repair. No real account, Stripe, message, email, booking, listing or Storage action is executed by these synthetic tests.

Run full native CI/build and PostgreSQL 17 full-schema rehearsal on the exact release commit before deploying to QA.

## BetterQA acceptance

1. Signed out and signed in, manually open /?booking_success=1, /?booking_cancelled=1, /?extension_success=1, /?extension_cancelled=1, /?stripe_onboarding=return and /?stripe_onboarding=refresh. None may claim paid, confirmed, extended, connected, no charge or link expiry based on the URL. Flags with false/0 values must not create those claims either.
2. Complete an authorized Stripe test checkout and extension. Compare the actual reservation/end-time and Transactions values. With delayed webhook fulfilment, the notice remains guidance; Refresh bookings performs a fresh load. Check Transactions before another payment. This release does not certify the underlying payment/fulfilment flow.
3. Leave checkout and revisit old cancellation URLs after a payment in another tab. No no-charge guarantee. Confirm normal booking, transaction and payout links, auth/role guards, keyboard focus and dismiss actions on mobile/desktop.
4. Return from completed/incomplete Stripe test onboarding or use an expired setup link. The notice must direct users to actual Host payout status, without asserting the outcome. Refresh payout status rechecks the current account through the existing authenticated view.
5. Confirm ordinary browsing has no notice; query parameters are stripped after return; refreshing does not repeat it. Message, View My Reservation and Add Additional Time email links keep working.

Signed-in Stripe/payment/webhook acceptance remains for BetterQA. These are code-review findings without a new BetterQA ID.

## Release and rollback

Deploy the exact tested SHA to QA project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app . Require exact-SHA/all-flag readiness, public/return pages and existing private endpoint denials. Use read-only before/after counts and booking/listing fingerprints. Do not revert concurrent tester data changes or claim all records unchanged if fingerprints differ. Confirm actual production unchanged. Verification performs no authenticated actions, no database writes and no migrations. Record final evidence in the PR body.

Rollback is a QA redeployment of 016688dfd10278b1cde99bde153b01e3584c1659. It retains backend protections but restores the misleading notices.
