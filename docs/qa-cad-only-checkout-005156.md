# BUG-005156 — CAD-only Checkout, booking totals and Transactions

BetterQA confirmed property-local booking times but paid RON through Stripe
Adaptive Pricing while ParkShare recorded its CAD integration/settlement total.
Stripe reports integration amounts in CAD even when local presentment differs;
the existing paid-webhook CAD amount checks do not disable Adaptive Pricing.

## Repair

- Both new booking and extension Checkout Sessions explicitly send
  `adaptive_pricing: {enabled: false}` and CAD price data.
- Only Checkout Session creation uses API version `2024-11-20.acacia`, where
  Stripe introduced per-session Adaptive Pricing controls. The installed Stripe
  SDK otherwise defaults to `2024-06-20`. The global SDK version, account API
  configuration and webhook versions remain unchanged.
- Before binding/returning a Checkout URL, verify that Stripe reports CAD,
  the exact trusted total and Adaptive Pricing disabled. A missing/unconfirmed
  setting fails closed, expires the undelivered session and releases its hold.
  Provider/registration failures retain the same cleanup protections.
- Driver/Host booking totals and recorded transaction amounts explicitly say
  CAD. Transactions identifies booking totals and explains that earlier Stripe
  conversions must be checked against the Stripe receipt for the actual card
  charge amount/currency. Native payout currency displays are unchanged.

## Validation

Execute both actual handler bodies against synthetic Auth/database/Stripe
boundaries. Even a request containing RON or Adaptive Pricing enabled must use
CAD, disable conversion, retain the connected Host account and collect the
trusted total/application fee. Cover failed/incorrect currency, total or
Adaptive Pricing confirmation and provider/registration failures with no URL
handoff and released holds. Exercise the installed Stripe SDK serialization to
verify the real request body and version/account headers without network calls.
Run full regression, build and native database/schema CI before QA deployment.

## BetterQA retest

1. Start a NEW Book Now and Schedule for Later checkout on verified listings 24
   (Toronto) and 23 (Bucharest). Use a Romanian browser/location. Check CAD is
   the checkout currency, with no RON/local-currency conversion offered.
2. Complete a Stripe TEST payment. Compare Checkout, Driver/Host confirmation,
   My Bookings, Host Dashboard and Transactions, including the CAD label and
   correct property-local time. Confirm one paid booking and no auto-refund.
3. Extend an active booking through a NEW checkout and repeat currency/total,
   extension-once, hold release, transaction and Driver confirmation checks.
4. Check CAD labels and explanatory text on narrow mobile screens.
5. Recheck cancellation/refund, abandoned checkout and extension failure cleanup.

Old open Checkout links may retain their previous configuration: start fresh.
Historical RON payments, amounts, refunds and previously sent/persisted emails
are not rewritten or represented as verified CAD card charges. Reconciliation
of those payments still requires their booking and Checkout/PaymentIntent IDs.
Issuer-level FX for a non-CAD card is outside ParkShare's Checkout currency.

QA only; no schema migration, real payment/refund, global Stripe setting change,
production release or team notification is part of this repair.

Primary references:
- https://docs.stripe.com/changelog/acacia/2024-11-20/adaptive-pricing-param
- https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing?payment-ui=stripe-hosted
