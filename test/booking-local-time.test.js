import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocalBookingStart } from "../api/_booking-local-time.js";

const utc = (bookingDate, startHour, timeZone) =>
  resolveLocalBookingStart({ bookingDate, startHour, timeZone }).toISOString();

test("Toronto scheduled booking is property local time, not UTC wall time", () => {
  assert.equal(utc("2026-10-20", 14, "America/Toronto"), "2026-10-20T18:00:00.000Z");
  assert.equal(utc("2026-01-20", 14, "America/Toronto"), "2026-01-20T19:00:00.000Z");
  assert.equal(utc("2026-10-20", 14.25, "America/Toronto"), "2026-10-20T18:15:00.000Z");
});

test("uses property's Canadian timezone including half-hour offsets", () => {
  assert.equal(utc("2026-10-20", 14, "America/Vancouver"), "2026-10-20T21:00:00.000Z");
  assert.equal(utc("2026-10-20", 14, "America/St_Johns"), "2026-10-20T16:30:00.000Z");
  assert.equal(utc("2026-10-20", 14, "America/Regina"), "2026-10-20T20:00:00.000Z");
});

test("local date stays attached to property's day at midnight", () => {
  assert.equal(utc("2026-10-20", 0, "America/Toronto"), "2026-10-20T04:00:00.000Z");
  assert.equal(utc("2026-10-20", 23.75, "America/Toronto"), "2026-10-21T03:45:00.000Z");
});

test("DST spring gap and autumn repeated hour fail closed", () => {
  assert.throws(() => utc("2026-03-08", 2.5, "America/Toronto"), /does not exist/);
  assert.throws(() => utc("2026-11-01", 1.5, "America/Toronto"), /ambiguous/);
  assert.equal(utc("2026-03-08", 3.25, "America/Toronto"), "2026-03-08T07:15:00.000Z");
});

test("rejects invalid zone, invalid date and invalid quarter-hour", () => {
  assert.throws(() => utc("2026-02-30", 14, "America/Toronto"), /not a real calendar date/);
  assert.throws(() => utc("2026-10-20", 14, "Bad/Timezone"), RangeError);
  assert.throws(() => utc("2026-10-20", 14, ""), /required/);
  assert.throws(() => utc("2026-10-20", 24, "America/Toronto"), /quarter-hour/);
  assert.throws(() => utc("2026-10-20", 14.2, "America/Toronto"), /quarter-hour/);
  assert.throws(() => utc("2026-10-20T14:00", 14, "America/Toronto"), /YYYY-MM-DD/);
});
