// Match the calendar date shown by clientBookingDisplay: scheduled bookings
// store their chosen wall-clock date as UTC; immediate bookings use local time.
export function getBookingDateKey(bookingStart, scheduled = false) {
  if (!bookingStart) return "";
  const start = new Date(bookingStart);
  if (!Number.isFinite(start.getTime())) return "";
  const year = scheduled ? start.getUTCFullYear() : start.getFullYear();
  const month = (scheduled ? start.getUTCMonth() : start.getMonth()) + 1;
  const day = scheduled ? start.getUTCDate() : start.getDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function matchesBookingDateRange(booking, fromDate = "", toDate = "") {
  if (!fromDate && !toDate) return true;
  if (fromDate && toDate && fromDate > toDate) return false;
  const date = getBookingDateKey(booking.bookingStart, booking.bookingIsScheduled);
  return Boolean(date && (!fromDate || date >= fromDate) && (!toDate || date <= toDate));
}
