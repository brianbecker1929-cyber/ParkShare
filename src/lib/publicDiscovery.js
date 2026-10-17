// Candidate anonymous browse contract: no raw address, Host identity,
// free-text listing title/description, or exact driveway boundary polygon.
export const PUBLIC_DISCOVERY_COLUMNS = "id,price,spaces,lat,lng,spots,created_at";

export function approximateParkingCoordinate(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function publicDiscoveryListing(listing, reviews = []) {
  if (!listing || !Number.isSafeInteger(Number(listing.id)) || Number(listing.id) <= 0) return null;
  const lat = approximateParkingCoordinate(listing.lat);
  const lng = approximateParkingCoordinate(listing.lng);
  const ratings = reviews.map(row => Number(row.rating)).filter(n => Number.isInteger(n) && n >= 1 && n <= 5);
  return {
    id: Number(listing.id),
    title: "Private parking available",
    address: "Approximate location — full address after confirmed booking",
    price: Number.isFinite(Number(listing.price)) ? Number(listing.price) : 0,
    spaces: Number.isSafeInteger(Number(listing.spaces)) && Number(listing.spaces) > 0 ? Number(listing.spaces) : 1,
    features: [],
    description: "",
    img: null,
    photos: [],
    spots: Array.isArray(listing.spots)
      ? listing.spots.slice(0,8).map(spot => ({ forRent: spot?.forRent === true }))
      : [],
    lat: lat !== null && lat >= -90 && lat <= 90 ? lat : null,
    lng: lng !== null && lng >= -180 && lng <= 180 ? lng : null,
    rating: ratings.length ? ratings.reduce((a,b) => a+b,0) / ratings.length : 0,
    reviewCount: ratings.length,
    host: "ParkShare Host",
    locationPrecision: "approximate",
  };
}
