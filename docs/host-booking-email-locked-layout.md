# ParkShare — approved Booking Ticket emails

Header approved October 11, 2026. This shared Booking Ticket layout applies to Host confirmation, Driver confirmation, extension confirmation, halfway check-in, and parking ending soon.

## Locked composition

- Navy header: William + Parker signature wordmark centered in the left half; the All-Caps Statement title centered in the right half. An amber vertical divider sits exactly halfway across the header.
- Use the approved larger logo and stacked Poppins ExtraBold title, with amber opening words and white closing words. Keep the title clear of outlines, rings, frames, and underlines.
- The shared header uses native presentation tables, including when media queries are ignored. Transparent, three-times-resolution PNG titles preserve Poppins in email clients without web-font support; descriptive alt text supplies the complete title when images are blocked. Title assets live in `public/email/headers/` and are served from the website.
- The title appears once, in the header. The greeting, one-sentence message, and approved William or Parker portrait remain below it.
- Keep the compact Booking Ticket status, spot badge, address, two time columns, Toronto local time, booked vehicle, licence plate, detailed driveway diagram, actions, and ESKA footer.
- Host and Driver confirmations show the full checkout total below Toronto local time. The extension shows its own amount charged in the same position.
- Halfway check-in and parking ending soon keep distinct wording and timings.
- Use presentation tables and inline styles with media-query enhancements. Real emails retain CID PNG attachments and hosted PNG fallbacks. No JavaScript is required to render email content.

## Preview and rollout

`/api/preview-host-email` and `/api/preview-renter-email?template=confirmation|extension|halfway|ending` use synthetic bookings and send no email. Both endpoints remain disabled in production.

The user approved the five final header mockups and explicitly requested merging this layout into main.

