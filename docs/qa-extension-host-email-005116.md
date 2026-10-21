# BUG-005116 follow-up: Host extension confirmation

BetterQA passed the extension settlement repair but found that only the Driver received the confirmation email.

The paid-extension notification now copies the current listing's Host on the Driver's existing confirmation, as the reminder notifications already do. The recipient is read from the listing's `host_id` and that Host's profile; checkout metadata cannot supply an email address. Blank Host addresses and a Host address matching the Driver are omitted from CC.

The existing receipt keeps the added duration, amount charged in CAD, property-local new end time, booking reference, spot, saved vehicle and inline images. Templates and booking/payment settlement are unchanged. A missing Host profile/address still permits the Driver receipt.

## Verification

- The signed-webhook delivery regression failed before the repair because the provider payload had no CC.
- The real signed webhook, installed Stripe/Supabase clients and mocked email transport exercise 1-, 4- and 8-bay bookings. Tests check the exact Driver/Host recipients, ignore an injected metadata address, and replay the paid event without adding time or sending a second email.
- Recipient edge cases exercise the actual notification function and real payload/template builders: whitespace, missing Host, duplicate mailbox, unavailable Host lookup, missing listing, and missing Driver/booking.
- All test recipients and payment events are synthetic. These checks send no actual email and make no real payment.

## BetterQA retest

On QA, extend a fresh paid active booking by one hour. Confirm the extension stays paid and applies once, and both the Driver and the Host receive the extension confirmation (Driver in To, Host in CC). Check the added hour, new property-local end time, CAD amount, booking reference, vehicle/plate and physical spot. Confirm the email's ParkShare links stay on QA.

If the same paid event is replayed in the Stripe test environment, it must not add time or send a duplicate notification. Failed/refunded extension attempts must not receive a success confirmation. Existing historical extensions are not resent by this deployment.

Live inbox delivery remains a BetterQA acceptance check. The existing non-blocking email failure handling is retained; this change does not introduce a new notification queue.
