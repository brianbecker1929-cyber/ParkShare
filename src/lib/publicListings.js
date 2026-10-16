// BUG-005161 — browse cards use metadata rather than embedded Base64 photos.
// A separate, cacheable image endpoint keeps historical pictures available
// without placing multi-megabyte Base64 fields in public listing JSON.

export const PUBLIC_LISTING_SELECT = [
  "id", "host_id", "title", "address", "price", "spaces",
  "features", "description", "lat", "lng", "spots",
  "availability", "created_at", "profiles(name)", "reviews(rating)",
].join(",");

export function publicListingCoverUrl(listingId) {
  const id = Number(listingId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return `/api/listing-cover?listingId=${id}`;
}

export function embeddedPhotoData(value) {
  if (typeof value !== "string" || value.length > 14 * 1024 * 1024) return null;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return null;
  return { mime: `image/${match[1].toLowerCase()}`, base64: match[2] };
}

export function trustedListingStorageUrl(value, supabaseUrl) {
  if (typeof value !== "string" || !supabaseUrl) return null;
  try {
    const target = new URL(value);
    const ownOrigin = new URL(supabaseUrl).origin;
    if (target.protocol !== "https:" || target.origin !== ownOrigin) return null;
    if (!target.pathname.startsWith("/storage/v1/object/public/listing-photos/")) return null;
    if (!/^\/[a-zA-Z0-9/%._-]+$/.test(target.pathname)) return null;
    if (target.search || target.hash) return null;
    return target.href;
  } catch {
    return null;
  }
}
