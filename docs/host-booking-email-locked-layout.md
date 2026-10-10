# ParkShare — approved Booking Ticket emails

Approved October 10, 2026. This shared layout replaces the October 9 Host-only composition and applies to Host confirmation, Driver confirmation, extension confirmation, halfway check-in, and parking ending soon.

## Locked composition

- Navy header: William + Parker signature wordmark on the left; one-line title on the right in a rounded rectangle with a white outer edge and amber inner edge.
- The title frame is 30% smaller than the first framed-title mockup. The signature logo was enlarged 30%, then another 33%; desktop target width is 328.51px, with responsive mobile sizes and room reserved for the title.
- The title appears once, in the header. The greeting, one-sentence message, and approved William or Parker portrait remain below it.
- Keep the compact Booking Ticket status, spot badge, address, two time columns, Toronto local time, booked vehicle, licence plate, detailed driveway diagram, actions, and ESKA footer.
- Host and Driver confirmations show the full checkout total below Toronto local time. The extension shows its own amount charged in the same position.
- Halfway check-in and parking ending soon keep distinct wording and timings.
- Use presentation tables and inline styles with media-query enhancements. Real emails retain CID PNG attachments and hosted PNG fallbacks. No JavaScript is required to render email content.

## Preview and rollout

`/api/preview-host-email` and `/api/preview-renter-email?template=confirmation|extension|halfway|ending` use synthetic bookings and send no email. Both endpoints remain disabled in production.

The user approved the five final header mockups and explicitly requested merging this layout into main.
