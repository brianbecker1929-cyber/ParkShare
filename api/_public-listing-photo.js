import {embeddedPhotoData, trustedListingStorageUrl, publicDrivewayPhotoUrl} from '../src/lib/publicListings.js';

// Read only photo references attached to this listing. A reference never grants
// access to another Host's files, unrelated buckets, arbitrary URLs or secrets.
export function listingPhotoStoragePath(value, hostId, supabaseUrl) {
  const own = trustedListingStorageUrl(value, supabaseUrl);
  if (!own || typeof hostId !== 'string') return null;
  const prefix = '/storage/v1/object/public/listing-photos/';
  let path;
  try { path = decodeURIComponent(new URL(own).pathname.slice(prefix.length)); } catch { return null; }
  if (!path.startsWith(`${hostId}/`) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(path.slice(hostId.length + 1))) return null;
  return path;
}

export function publishedPhotoUrls(listing, supabaseUrl) {
  const photos = Array.isArray(listing.photos) ? listing.photos.slice(0,6) : [];
  const primary = embeddedPhotoData(listing.img) || listingPhotoStoragePath(listing.img,listing.host_id,supabaseUrl);
  if (primary) photos[0] = listing.img;
  return photos.flatMap((photo,index) => embeddedPhotoData(photo) || listingPhotoStoragePath(photo,listing.host_id,supabaseUrl)
    ? [publicDrivewayPhotoUrl(listing.id,index)] : []);
}
