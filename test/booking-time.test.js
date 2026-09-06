import test from "node:test";
import assert from "node:assert/strict";
import { formatBookingTimeRemaining, getBookingDisplayStatus } from "../src/lib/bookingTime.js";

test("formats an active reservation countdown", () => {
  const now = new Date("2026-09-06T14:10:42Z").getTime();
  assert.equal(formatBookingTimeRemaining("2026-09-06T14:18:00Z", now), "7m 18s");
});

test("formats longer active reservations without an oversized seconds value", () => {
  const now = new Date("2026-09-06T14:10:42Z").getTime();
  assert.equal(formatBookingTimeRemaining("2026-09-06T15:16:00Z", now), "1h 05m");
});

test("marks elapsed countdowns as ended", () => {
  const now = new Date("2026-09-06T14:18:00Z").getTime();
  assert.equal(formatBookingTimeRemaining("2026-09-06T14:18:00Z", now), "Ended");
});

test("moves an upcoming booking through active and completed states", () => {
  const start = "2026-09-06T14:00:00Z";
  const end = "2026-09-06T15:00:00Z";
  assert.equal(getBookingDisplayStatus("Upcoming", start, end, new Date("2026-09-06T13:59:59Z").getTime()), "Upcoming");
  assert.equal(getBookingDisplayStatus("Upcoming", start, end, new Date("2026-09-06T14:30:00Z").getTime()), "Active");
  assert.equal(getBookingDisplayStatus("Active", start, end, new Date("2026-09-06T15:00:00Z").getTime()), "Completed");
});
