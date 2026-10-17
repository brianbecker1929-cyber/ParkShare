// Public discovery data contract for BetterQA BUG-005183.
// This module is intentionally separate from Host private listing access.
// Never return residential street addresses, exact coordinates, account IDs,
// driveway photos EXIF metadata, or Host-written free-text that can disclose
// a street address. Rounding to ~1km grid is approximate, NOT a privacy
// guarantee against correlation or separately published listing content.
export const PUBLIC_DISCOVERY_COLUMNS =
  "id,title,price,spaces,features,lat,lng,created_at";

export function approximateParkingCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export function publicDiscoveryListing(listing) {
  if (!listing || !Number.isSafeInteger(Number(listing.id))) return null;
  const lat = approximateParkingCoordinate(listing.lat);
  const lng = approximateParkingCoordinate(listing.lng);
  return {
    id: Number(listing.id),
    title: "Private parking available",
    price: Number.isFinite(Number(listing.price)) ? Number(listing.price) : null,
    spaces: Number.isSafeInteger(Number(listing.spaces)) ? Number(listing.spaces) : 1,
    // Avoid arbitrary Host-controlled features until their content is audited.
    lat: lat !== null && lat >= -90 && lat <= 90 ? lat : null,
    lng: lng !== null && lng >= -180 && lng <= 180 ? lng : null,
    locationPrecision: "approximate",
  };
}
