import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateEventSubmission } from "../api/_event-submission.js";

const valid = {
  organizerName: "Vaughan Festival Group",
  organizerEmail: "events@example.com",
  eventName: "ParkShare Community Festival",
  category: "festival",
  venueName: "Community Square",
  address: "1 Test Street, Vaughan, ON",
  eventDate: "2026-10-10",
  startTime: "12:30",
  endTime: "20:00",
  description: "A verified organizer-submitted community event.",
  ticketUrl: "https://example.com/tickets",
  eventUrl: "https://example.com/event",
  authorized: true,
};

test("accepts a complete organizer event submission", () => {
  const result = validateEventSubmission(valid, new Date("2026-09-07T12:00:00Z"));
  assert.equal(result.error, undefined);
  assert.equal(result.value.status, undefined);
  assert.equal(result.value.event_name, valid.eventName);
  assert.equal(result.value.organizer_email, valid.organizerEmail);
});

test("rejects unapproved, past, and unsafe-link submissions", () => {
  assert.match(validateEventSubmission({ ...valid, authorized: false }, new Date("2026-09-07T12:00:00Z")).error, /authorized/i);
  assert.match(validateEventSubmission({ ...valid, eventDate: "2026-08-01" }, new Date("2026-09-07T12:00:00Z")).error, /today or later/i);
  assert.match(validateEventSubmission({ ...valid, ticketUrl: "javascript:alert(1)" }, new Date("2026-09-07T12:00:00Z")).error, /http/i);
});

test("event submissions enter a private review queue instead of publishing directly", () => {
  const endpoint = readFileSync(new URL("../api/_event-submission.js", import.meta.url), "utf8");
  const contactEndpoint = readFileSync(new URL("../api/contact.js", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase-migration-009-event-submissions.sql", import.meta.url), "utf8");
  assert.match(endpoint, /from\("event_submissions"\)/);
  assert.match(endpoint, /status: "pending"/);
  assert.doesNotMatch(endpoint, /from\("events"\).*insert/s);
  assert.match(migration, /enable row level security/i);
  assert.doesNotMatch(migration, /create policy/i);
  assert.match(contactEndpoint, /requestType === "event-submission"/);
});
