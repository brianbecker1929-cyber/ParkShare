import test from "node:test";
import assert from "node:assert/strict";

import {
  EVENT_CATEGORIES,
  bookingEventFromRow,
  filterEvents,
  formatEventSchedule,
  getEventParkingSuggestion,
  normalizeEventRow,
} from "../src/lib/events.js";

const festival = {
  id: 42,
  source: "ParkShare organizer submission",
  name: "Vaughan Food Festival",
  category: "festival",
  venue_name: "Vaughan Civic Centre",
  address: "2141 Major Mackenzie Drive, Vaughan, ON",
  lat: 43.8767,
  lng: -79.5017,
  starts_at: "2026-09-12T20:30:00Z",
  ends_at: "2026-09-12T23:00:00Z",
  timezone: "America/Toronto",
  status: "published",
};

test("normalizes a licensed event row for ParkShare discovery", () => {
  const event = normalizeEventRow(festival);
  assert.equal(event.id, 42);
  assert.equal(event.venueName, "Vaughan Civic Centre");
  assert.equal(event.startsAt, "2026-09-12T20:30:00.000Z");
  assert.equal(event.category, "festival");
});

test("offers the approved event filters", () => {
  assert.deepEqual(EVENT_CATEGORIES.map(option => option.value), ["", "concert", "sports", "festival", "theatre", "community"]);
});

test("filters events by name, venue, category, and local event date", () => {
  const concert = { ...festival, id: 43, name: "ParkShare Live", category: "concert", venue_name: "Toronto Music Hall" };
  assert.deepEqual(filterEvents([concert, festival], { query: "Vaughan", category: "festival" }).map(event => event.id), [42]);
  assert.deepEqual(filterEvents([concert, festival], { query: "Music Hall", category: "concert" }).map(event => event.id), [43]);
  assert.deepEqual(filterEvents([festival], { date: "2026-09-12" }).map(event => event.id), [42]);
});

test("prefills parking one hour before and 45 minutes after a known event", () => {
  assert.deepEqual(getEventParkingSuggestion(festival), {
    date: "2026-09-12",
    startHour: 15.5,
    endHour: 19.75,
    durationHours: 4.25,
    hasKnownEnd: true,
    arrivalBufferMinutes: 60,
    departureBufferMinutes: 45,
  });
});

test("supports event parking that ends after midnight", () => {
  const overnight = {
    ...festival,
    id: 44,
    starts_at: "2026-09-13T03:00:00Z",
    ends_at: "2026-09-13T05:00:00Z",
  };
  const suggestion = getEventParkingSuggestion(overnight);
  assert.equal(suggestion.date, "2026-09-12");
  assert.equal(suggestion.startHour, 22);
  assert.equal(suggestion.endHour, 25.75);
  assert.equal(suggestion.durationHours, 3.75);
});

test("does not label an unknown event end as confirmed", () => {
  const withoutEnd = { ...festival, ends_at: null };
  const suggestion = getEventParkingSuggestion(withoutEnd);
  assert.equal(suggestion.hasKnownEnd, false);
  assert.match(formatEventSchedule(withoutEnd).time, /^4:30/);
});

test("rebuilds an event from the reservation snapshot", () => {
  const event = bookingEventFromRow({
    id: 9,
    event_id: 42,
    event_name: festival.name,
    event_category: festival.category,
    event_venue_name: festival.venue_name,
    event_address: festival.address,
    event_lat: festival.lat,
    event_lng: festival.lng,
    event_starts_at: festival.starts_at,
    event_ends_at: festival.ends_at,
    event_timezone: festival.timezone,
    event_source: festival.source,
  });
  assert.equal(event.name, festival.name);
  assert.equal(event.venueName, festival.venue_name);
});
