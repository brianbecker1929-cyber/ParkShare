# Public driveway photographs and exact locations

Brian confirmed on November 20, 2026 that driveway images and the exact
location are the information Drivers need to choose parking before booking.
This replaces the previous pre-booking approximate-location/photo suppression
policy for published listing previews.

Search results and listing details show the actual listing title, full street
address, unrounded map coordinates, supported listing features and cover photo.
The listing detail loads a bounded gallery on demand and offers an enlarged
photo. Navigation previews, address search and walking-route inputs use the
same exact listing coordinates.

The existing 50-record discovery RPC retains its pagination and review
aggregates. A bounded service-side metadata read restores title/address/exact
coordinates without selecting original Base64 images into the browse feed.
There is no database migration, data backfill, bucket publicity change or
change to existing payments, bookings, refunds or schedules.

The new public image endpoint only processes photographs attached to a
listing. It downloads Storage objects only from that listing Host's own
namespace, supports existing embedded images, applies image orientation,
removes source metadata and returns a bounded WebP preview. It never redirects
to private Storage or accepts an arbitrary URL. Missing/invalid photos show
the house placeholder. Original uploads remain unchanged.

Host account identifiers/contact information, payment records, free-text
arrival instructions and private bay geometry remain excluded from the
public response. Existing participant-only booking/message/photo endpoints
and raw-table RLS are unchanged. The publishing form and privacy copy explain
that driveway photos, addresses and map locations are public before booking.

Validate signed-out and signed-in browse on desktop/mobile, an actual legacy
photo, the exact address/pin, photo enlargement/gallery, address search and
route preview. Verify unrelated profile/payment fields remain absent and the
participant-only APIs still reject unauthorized access. Require native
regression and build checks before production deployment. Preserve the frozen
QA domain and its database; QA preview builds must not reassign that domain.
