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

// A Driver's own paid cancellation history may identify the reservation,
// matching Transactions. This does not restore precise-location entitlement.
export function canReadCancelledBookingTitle({ userId, booking, listingId }) {
  return Boolean(userId && booking
    && String(booking.renter_id) === String(userId)
    && Number(booking.listing_id) === Number(listingId)
    && ["cancelled", "canceled", "refunded"].includes(booking.status)
    && booking.application_state !== "rejected"
    && booking.paid_at && Number.isFinite(new Date(booking.paid_at).getTime())
    && typeof booking.stripe_checkout_session_id === "string"
    && booking.stripe_checkout_session_id.trim());
}

export function privateBookingListing(row, allowPrecise, retainHistoricalTitle = false) {
  if (!row) return null;
  if (!allowPrecise) return {
    id: row.id, title: retainHistoricalTitle ? row.title || "Private parking" : "Private parking",
    address: "Address available with a confirmed booking",
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

