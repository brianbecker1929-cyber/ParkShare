// Pure proposed foundation for BUG-005156. NOT wired into live booking creation.
// Booking dates/times must be interpreted in the parking property's IANA zone,
// not in UTC or the driver's device time zone.

function parseLocalStart(bookingDate, startHour) {
  if (typeof bookingDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    throw new RangeError("Booking date must be YYYY-MM-DD.");
  }
  const [year, month, day] = bookingDate.split("-").map(Number);
  const midnight = new Date(Date.UTC(year, month - 1, day));
  if (year < 100 || midnight.getUTCFullYear() !== year || midnight.getUTCMonth() + 1 !== month || midnight.getUTCDate() !== day) {
    throw new RangeError("Booking date is not a real calendar date.");
  }
  if (typeof startHour !== "number" || !Number.isFinite(startHour) || startHour < 0 || startHour >= 24 ||
    Math.abs(startHour * 4 - Math.round(startHour * 4)) > 1e-9) {
    throw new RangeError("Start hour must be a quarter-hour value from 0 through 23.75.");
  }
  const minutes = Math.round(startHour * 60);
  return { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

function formatInZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US-u-nu-latn", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = type => Number(parts.find(part => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function offsetMinutesAt(instant, timeZone) {
  const zonePart = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(instant).find(part => part.type === "timeZoneName")?.value;
  if (zonePart === "GMT") return 0;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zonePart || "");
  if (!match) throw new RangeError("Could not resolve a reliable timezone offset.");
  const result = Number(match[2]) * 60 + Number(match[3] || 0);
  return (match[1] === "+" ? 1 : -1) * result;
}

/**
 * Convert a local wall-clock booking start into a UTC instant.
 * Reject missing/invalid zones, DST gaps and DST folds rather than silently
 * booking the wrong time. Return a Date; caller must store an unambiguous UTC
 * instant and keep the property zone for future display.
 *
 * This helper is intentionally not used by checkout/DB until a coordinated
 * database migration, historic-data review and QA release are approved.
 */
export function resolveLocalBookingStart({ bookingDate, startHour, timeZone }) {
  const local = parseLocalStart(bookingDate, startHour);
  if (typeof timeZone !== "string" || !timeZone.trim()) {
    throw new RangeError("Parking property timezone is required.");
  }
  // Fail fast for invalid IANA zones. Device/server locale is never consulted.
  const anchor = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const uniqueOffsets = new Set();
  for (let delta = -36; delta <= 36; delta += 6) {
    uniqueOffsets.add(offsetMinutesAt(new Date(anchor + delta * 3600_000), timeZone));
  }
  const matching = [...uniqueOffsets].map(minutes => new Date(anchor - minutes * 60_000))
    .filter(date => {
      const actual = formatInZone(date, timeZone);
      return Object.keys(local).every(key => actual[key] === local[key]);
    }).sort((a, b) => a.getTime() - b.getTime());

  if (matching.length === 0) throw new RangeError("Local booking time does not exist due to a daylight-saving transition.");
  if (matching.length > 1) throw new RangeError("Local booking time is ambiguous due to a daylight-saving transition.");
  return matching[0];
}
