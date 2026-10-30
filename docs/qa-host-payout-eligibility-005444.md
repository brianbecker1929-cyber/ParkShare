# BUG-005444 — Require completed Host payouts setup before checkout

The checkout handlers previously accepted any connected account whose current
Stripe `charges_enabled` field was true. The Host dashboard used the stricter
combination of `details_submitted`, `charges_enabled` and `payouts_enabled`, so a
Driver could pay while the Host still saw unfinished Stripe verification.

Both initial booking and additional-time checkout now require all three current
Stripe fields to be exactly true. Incomplete or missing state returns HTTP 409
with `host_payouts_not_ready` before a checkout hold or Stripe Session is created.
The check reads Stripe each time; stale-ready database flags cannot authorize
payment. Provider failures remain errors with no hold or payment side effects.
Already-paid Checkout Sessions and webhook settlement are unchanged.

## Validation

- Forty focused checks passed, including all seven incomplete boolean
  combinations, missing/nonboolean fields, provider failure, absent account,
  stale cached readiness and a fully ready Host for both payment routes.
- The full local regression suite passed. Existing successful payment fixtures
  now explicitly model complete onboarding and enabled payouts.
- No database migration, onboarding-flag mutation, financial action, paid-hold
  deletion or production merge is part of this change.

## BetterQA retest

1. Use an incomplete Stripe test Host, including one with charges enabled but
   payouts disabled. Attempt a new booking and an extension. Expect HTTP 409,
   a clear message, and no new hold or Checkout Session.
2. Complete a separate eligible test Host's onboarding. Confirm a new Checkout
   Session can be opened for that Host.
3. End-to-end paid booking, refund, cancellation, extension and email validation
   remain blocked by BUG-005436 until the recovery webhook routing is verified.
   This eligibility repair does not resolve that independent delivery issue.

## BUG-005436 investigation checkpoint

BetterQA reports successful 4242 and 3DS payments without resulting bookings.
Recovery data has three registered test Checkout holds from October 28 without
bookings, including one on the requested Bremner Boulevard test listing. Preserve
their session/account/amount evidence until Stripe payment state is reconciled.
The preview logs show Checkout requests but no webhook-handler activity in the
reviewed pre-diagnostic window. An unsigned diagnostic POST to the fixed preview
`/api/stripe-webhook` returned HTTP 400 for a missing signature, confirming public
reachability and retained signature verification. This is evidence for a routing
investigation, not proof of the destination configuration or an end-to-end fix.

Use the same Stripe test account/sandbox as the Checkout Sessions. Inspect the
Connected accounts event destination, exact fixed recovery URL, enabled events,
delivery HTTP status/response and matching branch-only signing secret. Repair the
destination and reconcile/replay the original events before deciding whether the
stranded test reservation should become a booking or be refunded and released.
Do not drop the hold to bypass the listing foreign-key restriction while payment
state is unknown. Actual production and stable QA routing remain outside this
preview-only change.

Official references:
https://docs.stripe.com/api/accounts/object
https://docs.stripe.com/connect/webhooks
