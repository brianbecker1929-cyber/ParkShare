# BUG-005270 — Booking-email footer social destinations

The shared Booking Ticket footer contained Facebook, Twitter/X, YouTube and
LinkedIn profile URLs that did not match the current website footer. The reported
Facebook and LinkedIn destinations were unavailable/404. The website already
treats Facebook as unverified and X/LinkedIn as unpublished.

The repair removes the unverified Facebook, X and LinkedIn anchors, and changes
YouTube to https://www.youtube.com/@ParkerParksHere with descriptive link text.
This channel is also the website's existing destination; its public search
listing identifies ParkShare and links back to myparkshare.ca. No replacement
Facebook or LinkedIn profile is guessed, and this does not reactivate either
external account. Reintroduce those networks only after the owner supplies and
verifies the official public destinations.

The single shared footer change applies to Driver and Host confirmations,
extension confirmations, halfway reminders and ending-soon reminders. Support
email, website, booking actions, QA link isolation and the approved visual layout
remain unchanged. Previously sent emails and persisted retry payloads are not
rewritten.

## Validation and release

Existing rendered-email regressions now verify the corrected YouTube destination,
absence of the unverified profile anchors and retained support link. Full tests,
database-backed CI and build run in GitHub Actions because the local execution
environment is unavailable for this repair. No schema migration or production
deployment is required.

## BetterQA retest

1. Use fresh QA bookings/notifications and inspect all five email types.
2. Confirm there are no clickable Facebook, LinkedIn or X destinations.
3. Open ParkShare on YouTube and confirm the ParkShare channel is shown.
4. Verify support email, website, reservation, extension and messaging links.
   First-party links in QA emails must stay on parkshare-qa.vercel.app.
5. Check footer wrapping in Gmail/Outlook and on mobile.

Sample-only live QA previews (no email sent):
- /api/preview-renter-email?template=confirmation
- /api/preview-renter-email?template=extension
- /api/preview-renter-email?template=halfway
- /api/preview-renter-email?template=ending
- /api/preview-host-email

Acceptance distinction: the broken-link repair is ready for retest once deployed;
restoring Facebook/LinkedIn requires verified official URLs, not another guessed
profile path.
