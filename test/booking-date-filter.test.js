import test from "node:test";
import assert from "node:assert/strict";
import { getBookingDateKey, matchesBookingDateRange } from "../src/lib/bookingDateFilter.js";

const booking = date => ({ bookingStart: `${date}T23:30:00Z`, bookingIsScheduled: true });

test("date ranges include both boundary days and exclude days outside", () => {
  assert.equal(matchesBookingDateRange(booking("2026-09-30"), "2026-10-01", "2026-10-07"), false);
  assert.equal(matchesBookingDateRange(booking("2026-10-01"), "2026-10-01", "2026-10-07"), true);
  assert.equal(matchesBookingDateRange(booking("2026-10-07"), "2026-10-01", "2026-10-07"), true);
  assert.equal(matchesBookingDateRange(booking("2026-10-08"), "2026-10-01", "2026-10-07"), false);
});

test("the same From and To date finds bookings starting on one day", () => {
  assert.equal(matchesBookingDateRange(booking("2026-10-07"), "2026-10-07", "2026-10-07"), true);
  assert.equal(matchesBookingDateRange(booking("2026-10-06"), "2026-10-07", "2026-10-07"), false);
});

test("open-ended date ranges and clearing both dates work", () => {
  assert.equal(matchesBookingDateRange(booking("2026-10-08"), "2026-10-07", ""), true);
  assert.equal(matchesBookingDateRange(booking("2026-10-08"), "", "2026-10-07"), false);
  assert.equal(matchesBookingDateRange(booking("2026-09-30"), "", "2026-10-07"), true);
  assert.equal(matchesBookingDateRange({}, "", ""), true);
});

test("scheduled bookings preserve the selected calendar day near midnight", () => {
  assert.equal(getBookingDateKey("2026-10-07T00:15:00Z", true), "2026-10-07");
  assert.equal(getBookingDateKey("2026-12-31T23:45:00Z", true), "2026-12-31");
});

test("immediate bookings use the same local calendar day as their displayed date", () => {
  const localStart = new Date(2026, 9, 7, 0, 15).toISOString();
  assert.equal(getBookingDateKey(localStart, false), "2026-10-07");
  assert.equal(matchesBookingDateRange({ bookingStart: localStart }, "2026-10-07", "2026-10-07"), true);
});

test("overnight bookings are filtered by their start day", () => {
  const overnight = { ...booking("2026-10-06"), bookingEnd: "2026-10-07T01:30:00Z" };
  assert.equal(matchesBookingDateRange(overnight, "2026-10-07", "2026-10-07"), false);
});

test("reversed ranges and missing dates do not produce misleading matches", () => {
  assert.equal(matchesBookingDateRange(booking("2026-10-07"), "2026-10-08", "2026-10-01"), false);
  assert.equal(matchesBookingDateRange({ bookingStart: "invalid" }, "2026-10-01", ""), false);
  assert.equal(matchesBookingDateRange({}, "", "2026-10-07"), false);
});
