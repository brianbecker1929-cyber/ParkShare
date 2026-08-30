export function buildNavigationUrl(address, lat, lng, userAgent = globalThis.navigator?.userAgent || "") {
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const destination = hasCoords ? `${lat},${lng}` : String(address || "");
  const encodedDestination = encodeURIComponent(destination);
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent);

  return isIOS
    ? `https://maps.apple.com/?daddr=${encodedDestination}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}&travelmode=driving`;
}

export function openNavigation(listing) {
  if (typeof window === "undefined" || !listing) return;
  window.open(
    buildNavigationUrl(listing.address, listing.lat, listing.lng),
    "_blank",
    "noopener,noreferrer",
  );
}
