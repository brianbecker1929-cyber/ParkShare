// Pure, shared property-local time resolution for checkout and its preview.
// Never use the Driver's device zone to interpret either selected endpoint.
const formatterCache = new Map();
const offsetCache = new Map();
function cached(map, key, create, limit = 64) {
  if (!map.has(key)) {
    if (map.size >= limit) map.delete(map.keys().next().value);
    map.set(key, create());
  }
  return map.get(key);
}

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
  const formatter = cached(formatterCache, `parts:${timeZone}`, () => new Intl.DateTimeFormat("en-US-u-nu-latn", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }));
  const parts = formatter.formatToParts(instant);
  const get = type => Number(parts.find(part => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function offsetMinutesAt(instant, timeZone) {
  const zonePart = cached(formatterCache, `offset:${timeZone}`, () => new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }))
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
 */
export function resolveLocalBookingStart({ bookingDate, startHour, timeZone }) {
  const local = parseLocalStart(bookingDate, startHour);
  if (typeof timeZone !== "string" || !timeZone.trim()) {
    throw new RangeError("Parking property timezone is required.");
  }
  // Fail fast for invalid IANA zones. Device/server locale is never consulted.
  const anchor = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  // A date's candidate offsets are reusable across the quarter-hour picker.
  // Include both sides of transitions throughout the entire local date.
  const uniqueOffsets = cached(offsetCache, `${timeZone}:${bookingDate}`, () => {
    const offsets = new Set();
    const midnight = Date.UTC(local.year, local.month - 1, local.day);
    for (let delta = -36; delta <= 60; delta += 6) {
      offsets.add(offsetMinutesAt(new Date(midnight + delta * 3600_000), timeZone));
    }
    return offsets;
  });
  const matching = [...uniqueOffsets].map(minutes => new Date(anchor - minutes * 60_000))
    .filter(date => {
      const actual = formatInZone(date, timeZone);
      return Object.keys(local).every(key => actual[key] === local[key]);
    }).sort((a, b) => a.getTime() - b.getTime());

  if (matching.length === 0) throw new RangeError("Local booking time does not exist due to a daylight-saving transition.");
  if (matching.length > 1) throw new RangeError("Local booking time is ambiguous due to a daylight-saving transition.");
  return matching[0];
}

// End pickers express the next day as 24..47.75 (and API callers may
// express longer stays). Calendar arithmetic must precede zone resolution.
export function resolveLocalBookingEnd({ bookingDate, endHour, timeZone }) {
  const local = parseLocalStart(bookingDate, 0);
  if (typeof endHour !== "number" || !Number.isFinite(endHour) || endHour < 0 || endHour > 24 * 32 ||
      Math.abs(endHour * 4 - Math.round(endHour * 4)) > 1e-9) {
    throw new RangeError("End hour must be a valid quarter-hour time.");
  }
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + Math.floor(endHour / 24)));
  return resolveLocalBookingStart({
    bookingDate: date.toISOString().slice(0, 10), startHour: endHour % 24, timeZone,
  });
}

export function resolveLocalBookingWindow({ bookingDate, startHour, endHour, timeZone }) {
  const start = resolveLocalBookingStart({ bookingDate, startHour, timeZone });
  const end = resolveLocalBookingEnd({ bookingDate, endHour, timeZone });
  const hours = (end.getTime() - start.getTime()) / 3600_000;
  if (!Number.isFinite(hours) || hours <= 0) throw new RangeError("Choose an end time after the start time.");
  return { start, end, hours };
}
