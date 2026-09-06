export const RIDESHARE_PICKUP_BUFFER_MINUTES = 5;

const RIDESHARE_URLS = {
  uber: "https://m.uber.com/looking",
  lyft: "https://ride.lyft.com/u",
};

function normaliseLocation(listing = {}) {
  const latitude = Number(listing.lat);
  const longitude = Number(listing.lng);
  const hasLatitude = listing.lat !== null && listing.lat !== undefined && listing.lat !== "";
  const hasLongitude = listing.lng !== null && listing.lng !== undefined && listing.lng !== "";
  return {
    address: String(listing.address || "").trim(),
    label: String(listing.title || "ParkShare parking spot").trim(),
    hasCoordinates: hasLatitude && hasLongitude && Number.isFinite(latitude) && Number.isFinite(longitude),
    latitude,
    longitude,
  };
}

export function buildRideshareUrl(provider, listing, options = {}) {
  const selectedProvider = String(provider || "").toLowerCase();
  const baseUrl = RIDESHARE_URLS[selectedProvider];
  if (!baseUrl) return "";

  const location = normaliseLocation(listing);
  const params = new URLSearchParams();

  if (selectedProvider === "uber") {
    if (options.uberClientId) params.set("client_id", options.uberClientId);
    if (location.hasCoordinates) {
      params.set("pickup", JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        addressLine1: location.label,
        addressLine2: location.address,
      }));
    }
  }

  if (selectedProvider === "lyft") {
    if (options.lyftClientId) params.set("partner", options.lyftClientId);
    if (location.hasCoordinates) {
      params.set("pickup[latitude]", String(location.latitude));
      params.set("pickup[longitude]", String(location.longitude));
    }
  }

  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

export function getSuggestedPickupDate(estimatedArrival, bufferMinutes = RIDESHARE_PICKUP_BUFFER_MINUTES) {
  if (estimatedArrival === null || estimatedArrival === undefined || estimatedArrival === "") return null;
  const start = estimatedArrival instanceof Date ? estimatedArrival : new Date(estimatedArrival);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + Number(bufferMinutes || 0) * 60 * 1000);
}

export function formatRideshareTime(value, locale = "en-CA", options = {}) {
  const time = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(time.getTime())) return "";
  const formatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  if (options.timeZone) formatOptions.timeZone = options.timeZone;
  return new Intl.DateTimeFormat(locale, formatOptions).format(time);
}

export function formatSuggestedPickupTime(estimatedArrival, locale = "en-CA", options = {}) {
  const pickup = getSuggestedPickupDate(estimatedArrival);
  return pickup ? formatRideshareTime(pickup, locale, options) : "";
}
