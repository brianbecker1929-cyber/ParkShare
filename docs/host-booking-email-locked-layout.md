# ParkShare — locked Host booking confirmation email

Design approval: October 9, 2026. Final visual reference: the user-approved large William concept, with his belt aligned to the **uninterrupted** top edge of the navy reservation banner.

## Scope

This is the default visual system for **Host-side booking notifications**, rendered by `hostBookingNotificationHtml` in `api/_email.js` and invoked from `api/stripe-webhook.js`. Driver confirmation emails and other reminders are not restyled by this change. New future Host email types should reuse this layout and its shared Host imagery when added; do not imply email types have been created when they have not.

## Locked composition

- Navy header stays compact with the approved transparent William + Parker signature wordmark at 260 CSS pixels.
- Greeting/hero: left column presents *NEW BOOKING CONFIRMED!*, Host name, and one-sentence summary; William presents on the right.
- William uses the actual approved `public/william-v3/masters/ParkShare_William_05_Presenting.png` pose, rendered into an email-safe transparent PNG, tightly trimmed and cropped immediately beneath his yellow belt (55.5% of visible master height, before resizing). The head stays high and William reads as a large waist-up character.
- Portrait displays at 260px desktop, 181px on mobile. No image stretch; transparent edges stay clean.
- Portrait table cell has **zero bottom padding** and bottom vertical alignment. Immediately following it is the navy reservation header with **border-radius: 0**, creating one perfectly straight horizontal top edge; William's hidden lower body is implied behind the rectangle.
- The navy banner is never indented, notched, bent, or cut around William; the artwork stops precisely at that edge.
- This uses table HTML and a pre-cropped PNG, not negative margins, `z-index`, or `object-position` which are unreliable in email clients.
- Reservation summary, booked-vehicle identity and licence plate, Toronto local timestamps, driveway diagram, Host Dashboard CTA, and ESKA footer are preserved.

## Preview and rollout

A synthetic Host email preview can be reviewed on Vercel's feature-branch URL at `/api/preview-host-email`. It uses only sample booking data and sends no email. This endpoint is unavailable on production. Real Host notifications are sent only by the existing successful-booking webhook.

Do not merge the final layout into production until the user approves the deployed HTML preview; generated concept illustrations alone do not verify actual email rendering.
