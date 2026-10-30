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

// A closed Host schedule says nothing about whether a bay is occupied.
// Share this wording between the booking panel and the spot picker.
export function listingAvailabilityMessage(data, mode) {
  const when = mode === "now" ? "right now" : "that time";
  if (data?.hostScheduleOpen === false || data?.reason === "host_schedule") {
    return `Outside the Host's available hours for ${when}. Choose another time or a shorter duration.`;
  }
  if (data?.available === true) {
    return `${data.spacesFree} of ${data.spacesTotal} spot${data.spacesTotal === 1 ? "" : "s"} free for ${when}. Tap the one you'd like to park in.`;
  }
  if (data?.hostScheduleOpen === true && data?.available === false) {
    return `All spots are taken for ${when} — try a different ${mode === "now" ? "duration" : "time"}, or pick a different listing.`;
  }
  return "This time is unavailable. Please check availability again or choose another time.";
}

export function listingSpotStatusText({ isAvailable, hostEnabled, isRealListing, availableData, label }) {
  if (!hostEnabled) return "Not for rent";
  if (isAvailable) return "Available";
  if (isRealListing && !availableData) return "Checking…";
  if (availableData?.hostScheduleOpen === false) return "Unavailable";
  if (availableData?.spotState?.[label] === "booked") return "Already booked";
  if (availableData?.spotState?.[label] === "held") return "Checkout in progress";
  return "Unavailable";
}

export function cancelledCheckoutHold(search) {
  const params = new URLSearchParams(search);
  const id = params.get("checkout_hold");
  return params.get("booking_cancelled") === "1" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || "") ? id : null;
}

export function cancelledExtensionCheckoutHold(search) {
  const params = new URLSearchParams(search);
  const id = params.get("extension_hold");
  return params.get("extension_cancelled") === "1" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || "") ? id : null;
}

