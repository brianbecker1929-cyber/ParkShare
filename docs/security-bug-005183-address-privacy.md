# BUG-005183: Address and identity privacy — review-only

Read-only QA inspection on October 17, 2026 confirmed public SELECT policies using TRUE for listings, profiles and reviews. Anonymous and authenticated users can directly query these tables through Supabase PostgREST. Hiding map details in React alone does not remove the exposure.

## Prepared in this branch
- An allowlisted server-controlled candidate public parking endpoint returning fixed generic listing title, price, spaces, and coarse approximately 1km map grid. It never serializes exact street address, host/reviewer IDs, untrusted Host free-text, or full coordinates.
- Unit tests exercising public privacy.
- Neither endpoint nor frontend is deployed or cut over. Existing client public queries and Supabase policies remain unchanged.

## Required steps for a complete fix
1. Migrate ALL public map, parking list, listing detail, favorites, nearby destination, events, review, search and booking-preview reads off raw Supabase listings and profiles queries to scoped safe endpoints. Public walking distances must be marked approximate until booking.
2. Build an authenticated, server-side exact-address endpoint restricted to the Host who owns the listing or the actual Driver with an eligible confirmed reservation. Recheck booking status, owner identity, and the correct booking window on every request.
3. Migrate Host dashboard and Driver own-booking views to authorized private endpoints or narrowly controlled database privileges. Protect existing Host listing edits and messages.
4. Apply an approved database migration to REVOKE unrestricted SELECT from PUBLIC/anon/authenticated on listings, profiles, reviews and replace permissive read policies with verified role- and column-level access. Retain only essential service-role operations. Existing DELETE/UPDATE/INSERT grants and role rules also merit audit. Treat exposed views/RPCs/embedded relationships and ordering/filtering on sensitive fields as leakage paths.
5. Test direct REST calls for anonymous and logged-in users: listing wildcard / private columns, profiles email/Stripe account, reviewer user IDs, precise filtering/ordering, nested joins, other users' bookings/transactions, public map pins, direct image endpoints, geocoding URL and location EXIF. Check Host/Driver self-access and email/navigation after paid confirmation.
6. Coordinate QA release window and SQL migration with BetterQA. Ensure checkout and all dependent pages work BEFORE public launch.

**IMPORTANT**: The new endpoint is only the first safe component. BUG-005183 remains OPEN and launch-blocking until the SQL access controls and all UI paths are migrated and verified. No QA/production SQL or settings have been modified.
