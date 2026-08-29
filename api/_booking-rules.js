// Deterministic booking rules shared by the API and the automated test suite.
// Keep this module free of Stripe, Supabase, and environment-variable access so
// the business rules can be tested without live services or credentials.

export function spotIndexFromLabel(spotLabel) {
  const label = String(spotLabel || "").trim().toUpperCase();
  return /^[A-Z]$/.test(label) ? label.charCodeAt(0) - 65 : -1;
}

export function isRentableSpot(listing, spotLabel) {
  const spotIndex = spotIndexFromLabel(spotLabel);
  const configuredSpots = Array.isArray(listing?.spots) ? listing.spots : [];

  if (configuredSpots.length > 0) {
    return spotIndex >= 0
      && spotIndex < configuredSpots.length
      && configuredSpots[spotIndex]?.forRent === true;
  }

  const fallbackCapacity = Math.max(1, Number(listing?.spaces) || 1);
  return spotIndex >= 0 && spotIndex < fallbackCapacity;
}

export function windowsOverlap(startA, endA, startB, endB) {
  return startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime();
}

export function getSessionWindow(booking) {
  let start;
  if (booking.booking_date && booking.start_hour !== null && booking.start_hour !== undefined && booking.start_hour !== "") {
    const startHour = Number(booking.start_hour);
    const hh = String(Math.floor(startHour)).padStart(2, "0");
    const mm = String(Math.round((startHour % 1) * 60)).padStart(2, "0");
    const rawDate = String(booking.booking_date);
    const dateOnly = rawDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    const candidate = dateOnly ? new Date(`${dateOnly}T${hh}:${mm}:00Z`) : new Date(NaN);
    start = isNaN(candidate.getTime()) ? new Date(booking.paid_at) : candidate;
  } else {
    start = new Date(booking.paid_at);
  }

  const end = new Date(start.getTime() + Number(booking.hours) * 3600 * 1000);
  const isAdvance = start.getTime() - new Date(booking.paid_at).getTime() > 5 * 60 * 1000;
  return { start, end, isAdvance };
}

export function calculateBookingAmounts(price, hours, serviceFeeRate = 0.15) {
  const hourlyCents = Math.round(Number(price) * 100);
  const subtotalCents = Math.round(hourlyCents * Number(hours));
  const serviceFeeCents = Math.round(subtotalCents * serviceFeeRate);
  return {
    hourlyCents,
    subtotalCents,
    serviceFeeCents,
    totalCents: subtotalCents + serviceFeeCents,
  };
}

export function isNewWebhookInsert(insertedRows) {
  return Array.isArray(insertedRows) && insertedRows.length > 0;
}
