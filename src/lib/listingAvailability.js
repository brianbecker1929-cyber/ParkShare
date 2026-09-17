export const AVAILABILITY_DAYS = [
  { key: "sun", label: "Sunday", short: "Sun" },
  { key: "mon", label: "Monday", short: "Mon" },
  { key: "tue", label: "Tuesday", short: "Tue" },
  { key: "wed", label: "Wednesday", short: "Wed" },
  { key: "thu", label: "Thursday", short: "Thu" },
  { key: "fri", label: "Friday", short: "Fri" },
  { key: "sat", label: "Saturday", short: "Sat" },
];

const DAY_INDEX = AVAILABILITY_DAYS.reduce((acc, day, index) => ({ ...acc, [day.key]: index }), {});
const DAY_FROM_SHORT = { Sun: "sun", Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat" };
const allDay = () => [{ start: "00:00", end: "23:59" }];
const offDay = () => ({ enabled: false, windows: [] });
const onDay = (windows = allDay()) => ({ enabled: true, windows: windows.map(window => ({ ...window })) });

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  } catch {
    return "America/Toronto";
  }
}

export function createAvailabilityPreset(preset = "anytime", timezone = browserTimezone()) {
  const weekly = Object.fromEntries(AVAILABILITY_DAYS.map(day => [day.key, offDay()]));

  if (preset === "anytime") {
    AVAILABILITY_DAYS.forEach(day => { weekly[day.key] = onDay(); });
  } else if (preset === "weekdays") {
    ["mon", "tue", "wed", "thu", "fri"].forEach(day => { weekly[day] = onDay(); });
  } else if (preset === "weekends") {
    ["sat", "sun"].forEach(day => { weekly[day] = onDay(); });
  } else if (preset === "business") {
    ["mon", "tue", "wed", "thu", "fri"].forEach(day => { weekly[day] = onDay([{ start: "09:00", end: "17:00" }]); });
  } else if (preset === "evenings") {
    AVAILABILITY_DAYS.forEach(day => { weekly[day.key] = onDay([{ start: "17:00", end: "23:00" }]); });
  }

  return { version: 1, preset, timezone, weekly, exceptions: [] };
}

function safeWindow(window) {
  const start = /^\d{2}:\d{2}$/.test(String(window?.start || "")) ? String(window.start) : "09:00";
  const end = /^\d{2}:\d{2}$/.test(String(window?.end || "")) ? String(window.end) : "17:00";
  return { start, end };
}

export function normalizeAvailability(input) {
  if (!input || typeof input !== "object") return createAvailabilityPreset("anytime");
  const timezone = typeof input.timezone === "string" && input.timezone ? input.timezone : browserTimezone();
  const weekly = {};
  AVAILABILITY_DAYS.forEach(day => {
    const raw = input.weekly?.[day.key];
    const windows = Array.isArray(raw?.windows) ? raw.windows.map(safeWindow) : [];
    weekly[day.key] = { enabled: Boolean(raw?.enabled), windows };
  });
  const exceptions = Array.isArray(input.exceptions)
    ? input.exceptions
      .filter(exception => exception && typeof exception === "object")
      .map((exception, index) => ({
        id: String(exception.id || `exception-${index}`),
        type: ["unavailable", "available-all-day", "custom"].includes(exception.type) ? exception.type : "unavailable",
        startDate: String(exception.startDate || "").slice(0, 10),
        endDate: String(exception.endDate || exception.startDate || "").slice(0, 10),
        windows: Array.isArray(exception.windows) ? exception.windows.map(safeWindow) : [],
      }))
      .filter(exception => /^\d{4}-\d{2}-\d{2}$/.test(exception.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(exception.endDate))
    : [];

  return {
    version: 1,
    preset: ["anytime", "weekdays", "weekends", "business", "evenings", "custom"].includes(input.preset) ? input.preset : "custom",
    timezone,
    weekly,
    exceptions,
  };
}

export function hasAnyAvailability(input) {
  const availability = normalizeAvailability(input);
  if (availability.exceptions.some(exception => exception.type !== "unavailable")) return true;
  return AVAILABILITY_DAYS.some(day => availability.weekly[day.key]?.enabled && availability.weekly[day.key]?.windows?.length > 0);
}

function humanTime(value) {
  if (value === "00:00" || value === "23:59") return value === "00:00" ? "12am" : "midnight";
  const [hourString, minute = "00"] = String(value).split(":");
  const hour = Number(hourString);
  const suffix = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 || 12;
  return minute === "00" ? `${displayHour}${suffix}` : `${displayHour}:${minute}${suffix}`;
}

function daySummary(day) {
  if (!day?.enabled || !day.windows?.length) return "Closed";
  if (day.windows.length === 1 && day.windows[0].start === "00:00" && day.windows[0].end === "23:59") return "All day";
  return day.windows.map(window => `${humanTime(window.start)}–${humanTime(window.end)}`).join(", ");
}

export function formatAvailabilitySummary(input) {
  const availability = normalizeAvailability(input);
  const presetLabels = {
    anytime: "Available anytime · 24/7",
    weekdays: "Weekdays · all day",
    weekends: "Weekends · all day",
    business: "Mon–Fri · 9am–5pm",
    evenings: "Daily · 5pm–11pm",
  };
  if (presetLabels[availability.preset]) return presetLabels[availability.preset];

  const openDays = AVAILABILITY_DAYS.filter(day => availability.weekly[day.key]?.enabled);
  if (openDays.length === 0) return "No regular weekly hours";
  const groups = [];
  openDays.forEach(day => {
    const summary = daySummary(availability.weekly[day.key]);
    const previous = groups[groups.length - 1];
    if (previous && previous.summary === summary && DAY_INDEX[day.key] === DAY_INDEX[previous.last] + 1) {
      previous.last = day.key;
    } else {
      groups.push({ first: day.key, last: day.key, summary });
    }
  });
  return groups.slice(0, 3).map(group => {
    const first = AVAILABILITY_DAYS[DAY_INDEX[group.first]].short;
    const last = AVAILABILITY_DAYS[DAY_INDEX[group.last]].short;
    return `${first}${first === last ? "" : `–${last}`} · ${group.summary}`;
  }).join(" · ") + (groups.length > 3 ? " · …" : "");
}

function minutes(value) {
  const [hour = "0", minute = "0"] = String(value || "").split(":");
  return Number(hour) * 60 + Number(minute);
}

function isMinuteInsideWindows(minuteOfDay, windows = []) {
  return windows.some(window => {
    const start = minutes(window.start);
    let end = minutes(window.end);
    if (window.end === "23:59") end = 1440;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
    return minuteOfDay >= start && minuteOfDay < end;
  });
}

function localParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayKey: DAY_FROM_SHORT[parts.weekday],
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function matchingException(availability, date) {
  return [...availability.exceptions].reverse().find(exception => date >= exception.startDate && date <= exception.endDate) || null;
}

function isInstantAvailable(availability, instant) {
  const parts = localParts(instant, availability.timezone);
  const exception = matchingException(availability, parts.date);
  if (exception) {
    if (exception.type === "unavailable") return false;
    if (exception.type === "available-all-day") return true;
    return isMinuteInsideWindows(parts.minuteOfDay, exception.windows);
  }
  const day = availability.weekly[parts.dayKey];
  return Boolean(day?.enabled && isMinuteInsideWindows(parts.minuteOfDay, day.windows));
}

export function isListingAvailableForWindow(input, startValue, endValue) {
  const availability = normalizeAvailability(input);
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return false;

  // Booking and Host schedule inputs are on 15-minute boundaries. Checking
  // every five minutes plus the final instant avoids accepting a window that
  // crosses a closed period or an exception boundary.
  const stepMs = 5 * 60 * 1000;
  for (let cursor = start.getTime(); cursor < end.getTime(); cursor += stepMs) {
    if (!isInstantAvailable(availability, new Date(cursor))) return false;
  }
  return isInstantAvailable(availability, new Date(end.getTime() - 1));
}
