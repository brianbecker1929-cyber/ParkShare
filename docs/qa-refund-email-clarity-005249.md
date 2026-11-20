# BUG-005249 follow-up: cancellation/refund email clarity

The original missing-email defect passed BetterQA. This separate follow-up makes the cancellation context prominent without changing refunds or reopening that delivery result.

Cancellation receipts now lead with **Booking cancelled — refund confirmed**, name the recorded Driver, Host, Support or system actor, and show the recorded reason above the greeting/payment details. Missing attribution/reasons are explicitly identified as not recorded. Both audiences use the same booking record; the recipient or Stripe metadata cannot determine who cancelled.

Individual partial refunds are labelled partial when the original stored payment total is known. A confirmed booking's partial refund does not claim cancellation. Extension refunds retain extension wording even if the parent booking was later cancelled. A partial refund for an already-cancelled booking states both facts. Missing legacy totals retain neutral wording and never claim a full refund.

The amount in CAD, individual refund reference, booking, vehicle, spot, property-local times, recipient-specific action link, approved logo and Parker/William portraits remain present. Reasons are escaped as text, including literal template-looking brackets, and long text wraps on narrow screens.

The worker still freezes the payload before its first provider attempt. Retries reuse that exact payload/key; existing saved payloads and already-sent receipts are not rewritten or resent. This requires no database migration or payment/booking state change.

## Verification and BetterQA retest

- Worker tests honour query projections and verify both recipients, all supported/unknown actors, missing/malicious reasons, partial/extension/cancelled-parent scenarios, payload freezing, duplicate claims, provider failures and failed/pending refund suppression.
- Fixed synthetic previews are QA/preview-only, GET-only, uncached and marked noindex. They do not read customer records or send email. `/api/preview-refund-email?scenario=host&audience=driver` shows the Host-cancelled example; add `width=320`, `375` or `390` for a real narrow iframe viewport.
- On QA, cancel fresh eligible paid bookings once as Driver and once as Host with a recorded reason. Both inboxes should show the prominent cancellation headline, correct actor/reason and exact CAD amount/reference. Check desktop/mobile and QA action links.
- Where no reason was recorded, the receipt should say so. A partial refund for a confirmed booking must remain a partial-refund receipt with the booking confirmed. Extension refunds must identify the extension. Replay must not create duplicate receipts.
- Live inbox acceptance remains for BetterQA; synthetic tests/preview rendering do not send messages or make payments.
