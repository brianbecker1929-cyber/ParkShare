// Match clientBookingDisplay: canonical instants use the stored property zone.
// Without a property zone, preserve legacy scheduled UTC / immediate local dates.
export function getBookingDateKey(bookingStart, scheduled = false, propertyTimeZone = null) {
  if (!bookingStart) return "";
  const start = new Date(bookingStart);
  if (!Number.isFinite(start.getTime())) return "";
  if (propertyTimeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: propertyTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(start);
      const part = type => parts.find(value => value.type === type).value;
      return `${part("year")}-${part("month")}-${part("day")}`;
    } catch { return ""; }
  }
  const year = scheduled ? start.getUTCFullYear() : start.getFullYear();
  const month = (scheduled ? start.getUTCMonth() : start.getMonth()) + 1;
  const day = scheduled ? start.getUTCDate() : start.getDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function matchesBookingDateRange(booking, fromDate = "", toDate = "") {
  if (!fromDate && !toDate) return true;
  if (fromDate && toDate && fromDate > toDate) return false;
  const date = getBookingDateKey(booking.bookingStart, booking.bookingIsScheduled, booking.propertyTimeZone);
  return Boolean(date && (!fromDate || date >= fromDate) && (!toDate || date <= toDate));
}
