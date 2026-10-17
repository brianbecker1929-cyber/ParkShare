# BetterQA BUG-005183 — Residential address and identity privacy

**Status: code prepared for draft review; NOT deployed.** Active QA and production databases/applications are unchanged.

## Verified QA exposure (read-only inspection on October 17, 2026)
- Direct PostgREST SELECT on listings, profiles and reviews is public under existing USING true policies.
- listing-photos Storage bucket is public, allowing known photo URLs even if the browsing UI hides them.
- Booking RLS uses renter / Host ownership; BetterQA is independently auditing cross-user booking/transaction access.
- Public listing titles, descriptions, photos and exact spot geometry could reveal house numbers even if latitude/longitude were rounded.

## Prepared on PR #161
1. Public discovery: App.jsx now requests GET /api/public-parking rather than querying public Supabase listings/profiles/reviews. The server allows only listing ID, generic public title/address wording, rounded map pin, hourly price, space count, forRent flags, anonymous rating aggregate and non-sensitive UI placeholders. No raw Host/reviewer UUIDs, property title, exact address, free-text description, satellite spot geometry or photograph.
2. Public reviews: GET /api/public-reviews returns anonymized month/rating only. Free-text reviews are intentionally withheld until a moderation/privacy policy exists; this is an explicit temporary UX reduction.
3. Private bookings: GET /api/account-bookings requires a verified JWT. Host view filters listings to host_id=user.id and bookings to those listings. Driver view filters by renter_id=user.id, and precise listing location is returned only for paid confirmed/completed booking. Refunded/unpaid reservations receive a generic location.
4. Exact address: GET /api/private-listing-location checks Host ownership or a matching registered paid confirmed/completed reservation. A listing ID or an expired user token is not sufficient.
5. Messages: context-booking API no longer reveals a driveway location for a cancelled/unpaid or unrelated reservation.
6. Private covers: GET /api/listing-cover requires the same entitlement; legacy Base64 and Storage originals are proxied by the server as scaled WebP, not redirected to a known public object URL. Host and booked Driver cards fetch images using Authorization header and private no-store mode. Anonymous cards use a generic house glyph.
7. Approximate UX: public map routes use coarse pins only, no precise walking route measurement; navigation from optimistic confirmation waits for confirmed My Bookings to reveal the address.
8. Draft SQL: docs/sql-proposals/bug-005183-restrict-public-data-api.sql removes USING true policies, revokes anonymous/raw table reads, grants authenticated Host self-listings, member self-profiles, author self-reviews, and changes the listing-photos Storage bucket to private. It is a **proposal**, not a migration applied to any connected database.

## Review and remaining rollout work
- Coordinated database/website deployment is **mandatory**. Until SQL applies, direct raw Supabase reads and known public Storage photo URLs remain exposed in the existing environments; this draft alone does not close BUG-005183.
- Validate Host listing creation/update/delete, listing photos (old Base64 and new Storage), account signup/signin, booked Driver navigation, expired/cancelled status, prices, saved favorites, event discovery, messages, reservation extensions, and refunds.
- Confirm event notes and user-uploaded image EXIF do not leak a house address; test all signed and unsigned routes, logs, caches, search indexes, PostgREST view/RPC and nested join exposures.
- Anonymous walking distance is an estimate from ~0.01° grid, not accurate walking directions. UX copy must not claim exact minutes. Long-term allow city/neighborhood labels or privacy-safe geospatial search if needed.
- Public listing list currently caps at 200; before significant growth, add pagination. Anonymous photo previews and unmoderated written reviews are deliberately unavailable pending product signoff.
- The branch is based on QA performance PR #157 (which in turn depends on public search PR #151), not main. Merge plans must preserve those dependencies and coordinate BetterQA's active test window.
- Run comprehensive end-to-end tests in isolated preview + separate scratch database before promotion. No active QA SQL or production changes are approved or executed here.

**Release gate:** Close BUG-005183 only after the secure frontend/API **and** database + private Storage policy migration are deployed together, direct anonymous queries are denied, confirmed Driver/Host workflows pass and BetterQA signs off.
