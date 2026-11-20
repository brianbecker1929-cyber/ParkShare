// Physical indexes are permanent spot identities. Private bays remain in
// their original positions, even when only some spaces are offered for rent.
export function getListingSpotLayout(listing) {
  const configured = Array.isArray(listing?.spots) ? listing.spots : [];
  if (configured.length) {
    return configured.slice(0, 8).map((spot, index) => ({
      index, label: String.fromCharCode(65 + index), forRent: spot?.forRent === true,
    }));
  }
  const spaces = Number(listing?.spaces);
  const count = Number.isSafeInteger(spaces) && spaces > 0 ? Math.min(spaces, 8) : 0;
  return Array.from({ length: count }, (_, index) => ({
    index, label: String.fromCharCode(65 + index), forRent: true,
  }));
}
