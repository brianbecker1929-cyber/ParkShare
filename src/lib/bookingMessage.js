// Email links identify the booking only. The server resolves and verifies
// both participants before returning any conversation or listing context.
export function parseMessageBookingId(search) {
  const value = new URLSearchParams(search).get("message_booking");
  return /^\d+$/.test(value || "") && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value) : null;
}

export function bookingMessageListing(context) {
  const row = context.listing;
  return {
    id: `db-${row.id}`, title: row.title || "Parking listing", address: row.address || "",
    price: Number(row.price), rating: 0, reviewCount: 0, spaces: row.spaces,
    features: row.features || [], description: row.description || "", img: row.img || "🏠",
    photos: row.photos || [], distance: "—", lat: row.lat, lng: row.lng,
    spots: row.spots || [], availability: row.availability || null,
    host: context.hostName || "Host", hostImg: "🧑",
    bookingId: context.bookingId, participantId: context.recipient.id,
  };
}

export function bookingMessageThread(context) {
  return { ...bookingMessageListing(context), host: context.recipient.name,
    partyRole: context.recipient.role };
}
