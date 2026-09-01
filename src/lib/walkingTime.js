const MILES_TO_KM = 1.60934;
const ESTIMATED_WALKING_SPEED_KMH = 4.8;
const ROUTE_MATRIX_CHUNK_SIZE = 100;

export function estimateWalkingMinutes(distanceMiles) {
  if (!Number.isFinite(distanceMiles) || distanceMiles < 0) return null;
  const distanceKm = distanceMiles * MILES_TO_KM;
  return Math.max(1, Math.round((distanceKm / ESTIMATED_WALKING_SPEED_KMH) * 60));
}

function formatKilometres(distanceKm) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return null;
  return Math.max(0.1, distanceKm).toFixed(1);
}

export function buildWalkingLabel({ destinationSelected, loading, route, distanceMiles }) {
  if (!destinationSelected) return null;

  if (route && Number.isFinite(route.minutes)) {
    const distanceKm = Number.isFinite(route.distanceMeters)
      ? route.distanceMeters / 1000
      : distanceMiles * MILES_TO_KM;
    const formattedDistance = formatKilometres(distanceKm);
    return `🚶 ${route.minutes} min walk${formattedDistance ? ` · ${formattedDistance} km` : ""}`;
  }

  if (loading) return "🚶 Calculating walk…";

  const minutes = estimateWalkingMinutes(distanceMiles);
  const formattedDistance = formatKilometres(distanceMiles * MILES_TO_KM);
  if (!Number.isFinite(minutes)) return "🚶 Walking time unavailable";
  return `🚶 ≈ ${minutes} min walk${formattedDistance ? ` · ${formattedDistance} km` : ""}`;
}

export async function computeWalkingRoutes(listings, destination) {
  if (!Number.isFinite(destination?.lat) || !Number.isFinite(destination?.lng)) return {};
  if (typeof window === "undefined" || !window.google?.maps?.importLibrary) {
    throw new Error("Google Maps routing is unavailable");
  }

  const validListings = listings.filter(
    listing => Number.isFinite(listing.lat) && Number.isFinite(listing.lng),
  );
  if (validListings.length === 0) return {};

  const { RouteMatrix } = await window.google.maps.importLibrary("routes");
  const routesByListingId = {};

  for (let start = 0; start < validListings.length; start += ROUTE_MATRIX_CHUNK_SIZE) {
    const chunk = validListings.slice(start, start + ROUTE_MATRIX_CHUNK_SIZE);
    const response = await RouteMatrix.computeRouteMatrix({
      origins: chunk.map(listing => ({ lat: listing.lat, lng: listing.lng })),
      destinations: [{ lat: destination.lat, lng: destination.lng }],
      travelMode: "WALKING",
      fields: ["durationMillis", "distanceMeters", "condition"],
    });
    const rows = response?.matrix?.rows || [];

    chunk.forEach((listing, index) => {
      const route = rows[index]?.items?.[0];
      if (route?.condition !== "ROUTE_EXISTS" || !Number.isFinite(route.durationMillis)) return;
      routesByListingId[String(listing.id)] = {
        minutes: Math.max(1, Math.round(route.durationMillis / 60000)),
        distanceMeters: Number.isFinite(route.distanceMeters) ? route.distanceMeters : null,
      };
    });
  }

  return routesByListingId;
}
