export const EVENT_CATEGORIES = [
  { value: "", label: "All events" },
  { value: "concert", label: "Concerts" },
  { value: "sports", label: "Sports" },
  { value: "festival", label: "Festivals & markets" },
  { value: "theatre", label: "Theatre" },
  { value: "community", label: "Community" },
];

export const EVENT_ARRIVAL_BUFFER_MINUTES = 60;
export const EVENT_DEPARTURE_BUFFER_MINUTES = 45;

const VALID_CATEGORIES = new Set(EVENT_CATEGORIES.map(option => option.value).filter(Boolean));

function numericCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTimezone(value) {
  const timezone = String(value || "America/Toronto").trim();
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "America/Toronto";
  }
}

export function normalizeEventRow(row) {
  if (!row) return null;
  const lat = numericCoordinate(row.lat);
  const lng = numericCoordinate(row.lng);
  const startsAt = row.starts_at || row.startsAt;
  const start = new Date(startsAt);
  if (!row.id || !String(row.name || "").trim() || lat === null || lng === null || Number.isNaN(start.getTime())) return null;

  const rawEnd = row.ends_at || row.endsAt || null;
  const end = rawEnd ? new Date(rawEnd) : null;
  const category = String(row.category || "community").toLowerCase();

  return {
    id: row.id,
    name: String(row.name).trim(),
    category: VALID_CATEGORIES.has(category) ? category : "community",
    venueName: String(row.venue_name || row.venueName || "").trim(),
    address: String(row.address || "").trim(),
    lat,
    lng,
    startsAt: start.toISOString(),
    endsAt: end && !Number.isNaN(end.getTime()) && end > start ? end.toISOString() : null,
    timezone: eventTimezone(row.timezone),
    source: String(row.source || "ParkShare event partner").trim(),
    sourceUrl: String(row.source_url || row.sourceUrl || "").trim(),
    imageUrl: String(row.image_url || row.imageUrl || "").trim(),
    accessNotes: String(row.access_notes || row.accessNotes || "").trim(),
    closureNotice: String(row.closure_notice || row.closureNotice || "").trim(),
    lastSyncedAt: row.last_synced_at || row.lastSyncedAt || null,
  };
}

function partsInTimezone(value, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: eventTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}

function dateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function dayDifference(startParts, endParts) {
  const startDay = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
  const endDay = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
  return Math.round((endDay - startDay) / 86400000);
}

function roundQuarter(value) {
  return Math.round(Number(value) * 4) / 4;
}

export function getEventLocalDate(event) {
  const normalized = normalizeEventRow(event);
  if (!normalized) return "";
  return dateKey(partsInTimezone(normalized.startsAt, normalized.timezone));
}

export function formatEventSchedule(event, locale = "en-CA") {
  const normalized = normalizeEventRow(event);
  if (!normalized) return { date: "", time: "", full: "" };
  const start = new Date(normalized.startsAt);
  const end = normalized.endsAt ? new Date(normalized.endsAt) : null;
  const date = start.toLocaleDateString(locale, {
    timeZone: normalized.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: normalized.timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const startTime = timeFormatter.format(start);
  const endTime = end ? timeFormatter.format(end) : "End time not provided";
  return { date, time: end ? `${startTime}–${endTime}` : startTime, full: `${date} · ${end ? `${startTime}–${endTime}` : startTime}` };
}

export function filterEvents(events, { query = "", category = "", date = "" } = {}) {
  const needle = String(query).trim().toLowerCase();
  return (events || [])
    .map(normalizeEventRow)
    .filter(Boolean)
    .filter(event => !category || event.category === category)
    .filter(event => !date || getEventLocalDate(event) === date)
    .filter(event => !needle || [event.name, event.venueName, event.address].some(value => value.toLowerCase().includes(needle)))
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

export function getEventParkingSuggestion(event, {
  arrivalBufferMinutes = EVENT_ARRIVAL_BUFFER_MINUTES,
  departureBufferMinutes = EVENT_DEPARTURE_BUFFER_MINUTES,
} = {}) {
  const normalized = normalizeEventRow(event);
  if (!normalized) return null;

  const eventStart = new Date(normalized.startsAt);
  const parkingStart = new Date(eventStart.getTime() - arrivalBufferMinutes * 60000);
  const hasKnownEnd = Boolean(normalized.endsAt);
  // A missing event end is never presented as authoritative. Two hours after
  // the event start is only a selectable placeholder and the UI asks the
  // Driver to confirm their departure time.
  const eventEnd = hasKnownEnd ? new Date(normalized.endsAt) : new Date(eventStart.getTime() + 2 * 3600000);
  const parkingEnd = new Date(eventEnd.getTime() + (hasKnownEnd ? departureBufferMinutes : 0) * 60000);
  const startParts = partsInTimezone(parkingStart, normalized.timezone);
  const endParts = partsInTimezone(parkingEnd, normalized.timezone);
  const startHour = roundQuarter(startParts.hour + startParts.minute / 60);
  const endHour = roundQuarter(endParts.hour + endParts.minute / 60 + dayDifference(startParts, endParts) * 24);

  return {
    date: dateKey(startParts),
    startHour,
    endHour,
    durationHours: Math.max(1, roundQuarter((parkingEnd - parkingStart) / 3600000)),
    hasKnownEnd,
    arrivalBufferMinutes,
    departureBufferMinutes,
  };
}

export function bookingEventFromRow(row) {
  if (!row?.event_name) return null;
  return normalizeEventRow({
    id: row.event_id || `booking-event-${row.id}`,
    name: row.event_name,
    category: row.event_category,
    venue_name: row.event_venue_name,
    address: row.event_address,
    lat: row.event_lat,
    lng: row.event_lng,
    starts_at: row.event_starts_at,
    ends_at: row.event_ends_at,
    timezone: row.event_timezone,
    source: row.event_source,
    source_url: row.event_source_url,
    access_notes: row.event_access_notes,
    closure_notice: row.event_closure_notice,
  });
}
