// BUG-005140 — only a completed server availability check can unlock
// a real listing's specific Spot A/B/C/D in the Driver picker.
export function canChooseListingSpot({ isRealListing, hostRentable, availableData, label }) {
  if (!hostRentable) return false;
  if (!isRealListing) return true; // Demo listing preview has no server record
  if (availableData?.available !== true) return false;
  if (availableData?.hostScheduleOpen === false) return false;
  // Do not infer that free capacity means this specific bay is free.
  return availableData?.spotStatus?.[label] === true;
}

export function availabilityRequestKey({ listingId, mode, hours, bookingDate, startHour }) {
  return [
    String(listingId ?? "demo"),
    String(mode),
    String(hours),
    mode === "advance" ? String(bookingDate) : "now",
    mode === "advance" ? String(startHour) : "now",
  ].join(":");
}
