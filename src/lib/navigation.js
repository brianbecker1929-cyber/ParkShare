export const NAVIGATION_PROVIDER_DETAILS = {
  waze: { id: "waze", label: "Waze", shortLabel: "W" },
  google: { id: "google", label: "Google Maps", shortLabel: "G" },
  apple: { id: "apple", label: "Apple Maps", shortLabel: "A" },
};

export const NAVIGATION_PREFERENCE_KEY = "parkshare.navigationProvider";

export function isAppleMapsSupported(userAgent = globalThis.navigator?.userAgent || "") {
  return /iPad|iPhone|iPod|Macintosh|Mac OS X/i.test(userAgent);
}

export function getAvailableNavigationProviders(userAgent = globalThis.navigator?.userAgent || "") {
  const providers = [NAVIGATION_PROVIDER_DETAILS.waze, NAVIGATION_PROVIDER_DETAILS.google];
  if (isAppleMapsSupported(userAgent)) providers.push(NAVIGATION_PROVIDER_DETAILS.apple);
  return providers;
}

const isKnownProvider = provider => Object.prototype.hasOwnProperty.call(NAVIGATION_PROVIDER_DETAILS, provider);

export function getPreferredNavigationProvider(storage) {
  try {
    const provider = (storage || globalThis.localStorage)?.getItem(NAVIGATION_PREFERENCE_KEY);
    return isKnownProvider(provider) ? provider : null;
  } catch {
    return null;
  }
}

export function savePreferredNavigationProvider(provider, storage) {
  if (!isKnownProvider(provider)) return false;
  try {
    (storage || globalThis.localStorage)?.setItem(NAVIGATION_PREFERENCE_KEY, provider);
    return true;
  } catch {
    return false;
  }
}

const validCoordinates = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
const placeholderAddress = address => /^(?:approximate(?: parking)? (?:location|area)\b|address available with a confirmed booking$|exact parking location$)/i.test(String(address || "").trim());

export function hasNavigationDestination(listing) {
  if (!listing || typeof listing !== "object") return false;
  if (listing.locationPrecision === "approximate" || placeholderAddress(listing.address)) return validCoordinates(listing.lat, listing.lng);
  return validCoordinates(listing.lat, listing.lng) || Boolean(String(listing.address || "").trim());
}

export function buildNavigationUrl(address, lat, lng, userAgent = globalThis.navigator?.userAgent || "", provider, locationPrecision) {
  const hasCoords = validCoordinates(lat, lng);
  const cleanAddress = String(address || "").trim();
  const approximate = locationPrecision === "approximate" || placeholderAddress(cleanAddress);
  const hasAddress = !approximate && cleanAddress.length > 0;
  if (!hasCoords && !hasAddress) return null;
  // Public previews use only the same two-decimal area already in discovery.
  // Privacy labels must never become a map search or override a Waze pin.
  const routeLat = approximate ? Math.round(lat * 100) / 100 : lat;
  const routeLng = approximate ? Math.round(lng * 100) / 100 : lng;
  const destination = hasCoords ? `${routeLat},${routeLng}` : cleanAddress;
  const encodedDestination = encodeURIComponent(destination);
  const selectedProvider = provider || (isAppleMapsSupported(userAgent) ? "apple" : "google");

  if (selectedProvider === "waze") {
    const locationParams = [];
    // Waze supports q and ll together: q preserves the human-readable
    // ParkShare address while ll keeps the destination pin exact.
    if (hasAddress) locationParams.push(`q=${encodeURIComponent(cleanAddress)}`);
    if (hasCoords) locationParams.push(`ll=${encodedDestination}`);
    return `https://waze.com/ul?${locationParams.join("&")}&navigate=yes&utm_source=parkshare`;
  }

  if (selectedProvider === "apple") {
    return `https://maps.apple.com/?daddr=${encodedDestination}&dirflg=d`;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}&travelmode=driving`;
}

export function openNavigation(listing, provider) {
  if (typeof window === "undefined" || !listing) return false;
  const url = buildNavigationUrl(listing.address, listing.lat, listing.lng, window.navigator?.userAgent || "", provider, listing.locationPrecision);
  if (!url) return false;
  window.open(
    url,
    "_blank",
    "noopener,noreferrer",
  );
  return true;
}
