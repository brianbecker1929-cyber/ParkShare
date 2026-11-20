// A booking followed by its extension hold occupies one physical bay.
// Keep unlabelled historical rows separate rather than inventing a bay.
export function countOccupiedSpots(bookings, holds) {
  const occupied = new Set();
  for (const [kind, rows] of [["booking", bookings], ["hold", holds]]) {
    rows.forEach((row, index) => {
      const label = String(row.spot_label || "").trim().toUpperCase();
      occupied.add(label ? `spot:${label}` : `${kind}:${row.id ?? index}`);
    });
  }
  return occupied.size;
}
