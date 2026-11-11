// Preview instants in the property's verified zone, never the browser's zone.
// Arrival is still set by the server when payment succeeds.
export function formatBookNowTimes(timeZone, hours, now = Date.now()) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return null;
  const duration = Number(hours);
  const start = new Date(now);
  const end = new Date(start.getTime() + duration * 3600000);
  if (!Number.isFinite(duration) || duration <= 0
    || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
    });
    return {
      start: `${formatter.format(start)} (${timeZone})`,
      end: `${formatter.format(end)} (${timeZone})`,
    };
  } catch {
    // Missing or invalid property metadata must not silently use local time.
    return null;
  }
}
