function validPoint(point) {
  return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng));
}

export function getEstimatedArrivalDate(startedAt, durationMinutes) {
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const minutes = Number(durationMinutes);
  if (Number.isNaN(start.getTime()) || !Number.isFinite(minutes) || minutes < 0) return null;
  return new Date(start.getTime() + minutes * 60 * 1000);
}

export async function computeDrivingRoute(origin, destination) {
  if (!validPoint(origin) || !validPoint(destination)) {
    throw new Error("A current location and parking location are required");
  }
  if (typeof window === "undefined" || !window.google?.maps?.importLibrary) {
    throw new Error("Google Maps routing is unavailable");
  }

  const { RouteMatrix } = await window.google.maps.importLibrary("routes");
  const response = await RouteMatrix.computeRouteMatrix({
    origins: [{ lat: Number(origin.lat), lng: Number(origin.lng) }],
    destinations: [{ lat: Number(destination.lat), lng: Number(destination.lng) }],
    travelMode: "DRIVING",
    routingPreference: "TRAFFIC_AWARE",
    fields: ["durationMillis", "distanceMeters", "condition"],
  });
  const route = response?.matrix?.rows?.[0]?.items?.[0];
  if (route?.condition !== "ROUTE_EXISTS" || !Number.isFinite(route.durationMillis)) {
    throw new Error("A driving route could not be calculated");
  }

  return {
    minutes: Math.max(1, Math.ceil(route.durationMillis / 60000)),
    distanceMeters: Number.isFinite(route.distanceMeters) ? route.distanceMeters : null,
  };
}
