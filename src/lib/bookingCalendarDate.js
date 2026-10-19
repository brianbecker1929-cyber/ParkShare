// Preserve the date the Driver chose on their device calendar.
// Date.toISOString() converts midnight into UTC and may shift the date
// when the browser is in Greece/Vancouver/etc. Server will interpret this
// calendar day in the parking property's verified IANA timezone.
export function localCalendarDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new RangeError("Choose a valid booking date.");
  }
  const year = date.getFullYear(), month = date.getMonth() + 1, day = date.getDate();
  return [String(year).padStart(4,"0"),String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("-");
}

export function futureBookingDate(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = name => Number(parts.find(p => p.type === name).value);
  const tomorrow = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1));
  // The date picker uses a device-local Date solely as a calendar container.
  return new Date(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate());
}
