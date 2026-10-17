// Authorization decisions for private property location data.
// Never infer entitlement from having a listing ID or from Stripe metadata.
export const PAID_LOCATION_STATUSES = new Set(["confirmed", "completed"]);

export function validId(value) {
  const raw = String(value ?? "");
  const numeric = Number(raw);
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(numeric) ? numeric : null;
}

export function canReadPreciseLocation({ userId, hostId, booking, listingId }) {
  if (!userId) return false;
  if (userId === hostId) return true;
  return Boolean(booking
    && String(booking.renter_id) === String(userId)
    && Number(booking.listing_id) === Number(listingId)
    && PAID_LOCATION_STATUSES.has(booking.status)
    && booking.paid_at
    && booking.stripe_checkout_session_id);
}

export function privateBookingListing(row, allowPrecise) {
  if (!row) return null;
  if (!allowPrecise) return {
    id: row.id, title: "Private parking", address: "Address available with a confirmed booking",
    lat: null, lng: null, spaces: row.spaces, spots: [],
    description: "", profiles: { name: "Host" },
  };
  return {
    id: row.id, title: row.title, address: row.address,
    lat: row.lat, lng: row.lng, spaces: row.spaces,
    spots: row.spots || [], description: row.description || "",
    profiles: { name: row.profiles?.name || "Host" },
  };
}
