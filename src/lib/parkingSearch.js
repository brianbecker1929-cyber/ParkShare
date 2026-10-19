// Browse radius is measured from privacy-safe public coordinates, not a walking route.
export const PARKING_SEARCH_RADIUS_KM = 5;
const MILES_TO_KM = 1.60934;

export function validParkingCoordinate(point) {
  return Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point?.lng) && Math.abs(point.lng) <= 180;
}

export function parkingDistanceKm(origin, listing) {
  if (!validParkingCoordinate(origin) || !validParkingCoordinate(listing)) return null;
  const radians = value => value * Math.PI / 180;
  const a = Math.sin(radians(listing.lat - origin.lat) / 2) ** 2
    + Math.cos(radians(origin.lat)) * Math.cos(radians(listing.lat))
    * Math.sin(radians(listing.lng - origin.lng) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export function matchesParkingText(listing, query) {
  const text = String(query || "").trim().toLocaleLowerCase();
  if (!text) return true;
  // Only inspect the fields already permitted in this listing DTO. Never fetch
  // private titles/addresses to make anonymous search more permissive.
  return [listing.title, listing.address].some(value => String(value || "").toLocaleLowerCase().includes(text));
}

export function nearbyParkingListings(listings, { origin, query = "", radiusKm = PARKING_SEARCH_RADIUS_KM } = {}) {
  const hasOrigin = origin != null;
  return listings.filter(listing => matchesParkingText(listing, query))
    .map(listing => {
      const km = parkingDistanceKm(origin, listing);
      return { ...listing, distMiles: km === null ? null : km / MILES_TO_KM };
    })
    .filter(listing => !hasOrigin || (Number.isFinite(listing.distMiles) && listing.distMiles * MILES_TO_KM <= radiusKm));
}

export function parkingSearchEmptyState({ query, origin, destinationSelected }) {
  if (String(query || "").trim() && !destinationSelected) {
    return { title: "No parking matches your search", message: `No listings match “${query.trim()}”${origin ? ` within ${PARKING_SEARCH_RADIUS_KM} km of your location` : ""}. Choose a destination suggestion or try another search.` };
  }
  if (origin) {
    return { title: "No parking nearby", message: `No listed parking was found within ${PARKING_SEARCH_RADIUS_KM} km of ${destinationSelected ? "this destination" : "your location"}. Try another destination or clear your search. Public locations and distances are approximate.` };
  }
  return { title: "No parking matches your search", message: "Try another destination or clear your search." };
}
