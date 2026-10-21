// BUG-005138: validate date-only Host schedule exceptions without allowing
// the browser's local timezone to shift dates around UTC midnight.
//
// These are *calendar dates* (YYYY-MM-DD), not UTC booking instants.
// A valid exception begins today or later in its configured schedule zone,
// and ends on/after its start. Historic published listings are not mutated.

export function dateInScheduleTimezone(timezone, now = new Date()) {
  if (typeof timezone !== "string" || !timezone.trim()) return null;
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(date)
        .filter(part => ["year", "month", "day"].includes(part.type))
        .map(part => [part.type, part.value])
    );
    return /^\d{4}$/.test(parts.year) && /^\d{2}$/.test(parts.month)
      && /^\d{2}$/.test(parts.day)
      ? parts.year + "-" + parts.month + "-" + parts.day
      : null;
  } catch {
    // Invalid IANA zone: do not silently interpret a Canadian Host's dates
    // using the visiting Host's browser timezone or the server's UTC clock.
    return null;
  }
}

export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addCalendarDays(dateOnly, amount) {
  if (!isCalendarDate(dateOnly) || !Number.isInteger(amount)) return null;
  const date = new Date(dateOnly + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

// Twelve calendar months, inclusive. Clamp leap day to February 28 instead
// of rolling into March; this is not a fixed 365-day window.
export function latestHostExceptionDate(today) {
  if (!isCalendarDate(today)) return null;
  const date = new Date(today + "T00:00:00.000Z");
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  const latest = date.toISOString().slice(0, 10);
  return isCalendarDate(latest) ? latest : null;
}

export function validateHostExceptionDates(exception, today) {
  const latest = latestHostExceptionDate(today);
  if (!latest) {
    return { valid: false, error: "The driveway schedule timezone is invalid. Check the timezone before saving special dates." };
  }
  if (!isCalendarDate(exception?.startDate) || !isCalendarDate(exception?.endDate)) {
    return { valid: false, error: "Choose valid From and To dates for this exception." };
  }
  if (exception.startDate < today || exception.endDate < today) {
    return { valid: false, error: "Special dates cannot be in the past. Choose today or a future date." };
  }
  if (exception.endDate < exception.startDate) {
    return { valid: false, error: "The To date must be on or after the From date." };
  }
  if (exception.startDate > latest || exception.endDate > latest) {
    return { valid: false, error: `Special dates must be within 12 calendar months of today (through ${latest}).` };
  }
  return { valid: true, error: null };
}

export function validateHostAvailabilityExceptions(input, now = new Date()) {
  const today = dateInScheduleTimezone(input?.timezone, now);
  if (!today) return {
    valid: false, today: null, latest: null,
    issues: [{ id: "timezone", error: "The driveway schedule timezone is invalid. Check it before publishing." }],
  };
  const issues = [];
  for (const [index, exception] of (Array.isArray(input?.exceptions) ? input.exceptions : []).entries()) {
    const result = validateHostExceptionDates(exception, today);
    if (!result.valid) issues.push({ id: exception?.id ?? ("exception-" + index), error: result.error });
  }
  return { valid: issues.length === 0, today, latest: latestHostExceptionDate(today), issues };
}
