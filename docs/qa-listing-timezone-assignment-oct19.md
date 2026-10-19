# QA follow-up: timezone assignment for new listings

Code-identified follow-up to BUG-005221; no separate BetterQA ID assigned. QA-only, stacked on PR #193 and all earlier repairs. Production/main remain outside this release.

## Resulting behaviour

- Publishing uses authenticated `POST /api/host-listings`. The server verifies the account's Host role from `profiles`, derives ownership from the authenticated principal, and computes the IANA timezone from the submitted numeric property pin using pinned `geo-tz@8.1.10` comprehensive boundaries. A client-supplied zone/owner/capacity cannot override those values. No Toronto fallback.
- A read-only preview on that endpoint confirms the property's timezone before publishing and displays the clock used by availability. The final publish resolves the zone again independently. Availability hours and date exceptions are validated in that property timezone, including when a Host visits from a remote browser timezone.
- Missing/invalid coordinates, multiple-zone results and offshore fallback zones block publishing with an actionable pin message. Zero-valued coordinates are accepted when they represent a valid land location, rather than silently becoming null.
- Editing street, city, province or postal code clears stale coordinates and drawn bay geometry. Selecting a fresh suggestion or dragging the pin clears old geometry. Late address/timezone responses cannot overwrite newer choices; temporary timezone-preview errors have a retry action.
- A database trigger blocks direct authenticated listing inserts and direct address/coordinate/timezone changes. Existing price, description, features and space edits continue through their existing Host policies. The Host dashboard currently has no address-relocation editor; this repair does not introduce one or relocate existing listings.
- Server validation covers owned Storage photo paths, supported features, rate, bounded parking spots/geometry and property-local availability. Photos remain intact when a publication response is uncertain; the Host is directed to check their dashboard before retrying, instead of deleting photos that may already belong to a published listing.

The pin is validated for geographic timezone calculation. This is not proof of street-address accuracy or property ownership. Existing Canadian postal-format rules remain enforced. Romania is covered by geographic/timezone regression cases and existing non-Canadian QA listing scenarios; the Canadian listing form is not expanded to new countries.

## Validation

Run `node --test --test-reporter=spec --test-concurrency=1 test/*.test.js test/database/*.test.js`, the Vite build, and the PostgreSQL 17 full-schema rehearsal. The rehearsal installs this migration last, checks raw Host inserts/location edits are denied, confirms ordinary Host edits still work, and verifies historical booking fields are preserved.

Both the publishing and QA-readiness functions explicitly package the runtime geographic data files. Release readiness performs real Toronto/Bucharest lookups and checks the deployed database publishing guard, without creating any listing or account.

No real signup, property publication, Storage upload, booking, payment or email is performed during release verification. BetterQA must test signed-in Host publication and the resulting scheduled checkout/received emails.

## BetterQA acceptance

1. Create a new Canadian listing from a valid Toronto address suggestion, confirm its pin, upload a test photo, configure hours and publish. Confirm its verified zone is America/Toronto and Schedule for Later works without manual database setup.
2. Repeat with the Host's browser set to a remote timezone. Check availability exception dates and the Driver/Host booked times remain in the property's clock.
3. Choose one address, edit the street/city/province/postal code and verify the old pin/geometry cannot be published. Select the correct suggestion, redraw bays if needed, then proceed. Rapidly change suggestions while the lookup is pending.
4. Check missing, invalid, offshore or ambiguous pins give actionable errors and no listing insert. A temporary lookup failure should allow Check location again.
5. Verify a Driver cannot publish through the new API. Confirm a Host's direct Supabase insert cannot bypass verification and direct location/zone tampering is blocked. Price/description/space edits must still work.
6. Confirm all prior QA repair scenarios remain available, including public browse, booking cancellation and refunds. Use new Stripe TEST bookings for email acceptance.

## Release procedure and rollback

Require native regression/build and full-schema CI on the exact release commit. Apply the migration only to QA project `biydlfekindgaslgktsx`; record the service-assigned migration version in the repository. Preserve booking/listing digests and counts, extension/refund rows and Storage objects. Deploy only Vercel project `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC` (`parkshare-qa`) and verify `propertyTimezoneLookupReady` and `propertyTimezoneGuardReady`.

The migration changes a trigger function and adds a server-only readiness function. It performs no listing, booking, payment, refund or Storage backfill. Existing unlocated listings still require a separately reviewed location correction; historical booking snapshots remain intact.

Rollback requires redeploying the previous QA commit AND restoring the previous trusted-zone trigger body from the prior migration so the old client publication path can operate again. Keep prior refund/photo-cleanup/public-feed protections installed. Do not rewind application data. Never apply that rollback to production/main as part of this QA workflow.
