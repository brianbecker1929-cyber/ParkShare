import {hasListingCoordinates} from './listingLocation.js';

// Keep draft corners within the publication API's existing driveway-pin bounds.
export function satelliteSpotPoint(latLng, center) {
  const point = {
    lat: typeof latLng?.lat === 'function' ? latLng.lat() : latLng?.lat,
    lng: typeof latLng?.lng === 'function' ? latLng.lng() : latLng?.lng,
  };
  if (!hasListingCoordinates(point) || !hasListingCoordinates(center)
      || Math.abs(point.lat - center.lat) > 0.01 || Math.abs(point.lng - center.lng) > 0.01) return null;
  return point;
}

export function satelliteSpotBounds(first, second) {
  if (!hasListingCoordinates(first) || !hasListingCoordinates(second)
      || first.lat === second.lat || first.lng === second.lng) return null;
  return {
    north: Math.max(first.lat, second.lat), south: Math.min(first.lat, second.lat),
    east: Math.max(first.lng, second.lng), west: Math.min(first.lng, second.lng),
  };
}
