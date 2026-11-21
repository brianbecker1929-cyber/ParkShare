// Published driveway photos and exact locations are marketplace information.
// Keep account identities, payment details, arrival notes and bay geometry private.
import {normalizeBookingStatus} from './bookingReadiness.js';
import {publicDrivewayPhotoUrl} from './publicListings.js';
import {LISTING_FEATURE_OPTIONS} from './listingSettings.js';
export const PUBLIC_DISCOVERY_COLUMNS = "id,title,address,features,lat,lng";

export function publicParkingCoordinate(value, limit) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

export function publicDiscoveryListing(listing, reviews = []) {
  if (!listing || !Number.isSafeInteger(Number(listing.id)) || Number(listing.id) <= 0) return null;
  const lat = publicParkingCoordinate(listing.lat, 90);
  const lng = publicParkingCoordinate(listing.lng, 180);
  const cover = publicDrivewayPhotoUrl(listing.id);
  const ratings = reviews.map(row => Number(row.rating)).filter(n => Number.isInteger(n) && n >= 1 && n <= 5);
  return {
    id: Number(listing.id),
    title: typeof listing.title === 'string' && listing.title.trim() ? listing.title.slice(0,200) : "Parking space",
    address: typeof listing.address === 'string' ? listing.address.slice(0,1000) : "",
    price: Number.isFinite(Number(listing.price)) ? Number(listing.price) : 0,
    spaces: Number.isSafeInteger(Number(listing.spaces)) && Number(listing.spaces) > 0 ? Number(listing.spaces) : 1,
    features: Array.isArray(listing.features) ? LISTING_FEATURE_OPTIONS.filter(feature => listing.features.includes(feature)) : [],
    description: "",
    img: cover,
    photos: [cover],
    spots: Array.isArray(listing.spots)
      ? listing.spots.slice(0,8).map(spot => ({ forRent: spot?.forRent === true }))
      : [],
    lat,
    lng,
    rating: listing.review_count == null ? (ratings.length ? ratings.reduce((a,b) => a+b,0) / ratings.length : 0) : Number(listing.rating),
    reviewCount: listing.review_count == null ? ratings.length : Number(listing.review_count),
    ...(listing.time_zone ? { timeZone: listing.time_zone } : {}),
    host: "ParkShare Host",
    bookingStatus: normalizeBookingStatus(listing.bookingStatus),
    locationPrecision: "exact",
  };
}
