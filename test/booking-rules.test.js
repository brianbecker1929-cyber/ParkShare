import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateBookingAmounts,
  getSessionWindow,
  isNewWebhookInsert,
  isRentableSpot,
  isValidBookingDuration,
  spotIndexFromLabel,
  windowsOverlap,
} from "../api/_booking-rules.js";

test("booking durations enforce a one-hour minimum and valid increments", () => {
  assert.equal(isValidBookingDuration(0.01), false);
  assert.equal(isValidBookingDuration(0.25), false);
  assert.equal(isValidBookingDuration(0.5), false);
  assert.equal(isValidBookingDuration(1), true);
  assert.equal(isValidBookingDuration(1.25), true);
  assert.equal(isValidBookingDuration(2), true);
  assert.equal(isValidBookingDuration(1.1), false);
  assert.equal(isValidBookingDuration(745), false);

  assert.equal(isValidBookingDuration(1, { scheduled: true }), true);
  assert.equal(isValidBookingDuration(1.25, { scheduled: true }), false);
  assert.equal(isValidBookingDuration(2, { scheduled: true }), true);
});

test("configured rentable spots use the host's explicit per-spot settings", () => {
  const listing = {
    spaces: 1,
    spots: [
      { forRent: false },
      { forRent: false },
      { forRent: false },
      { forRent: true },
    ],
  };

  assert.equal(isRentableSpot(listing, "D"), true);
  assert.equal(isRentableSpot(listing, "d"), true);
  assert.equal(isRentableSpot(listing, "A"), false);
  assert.equal(isRentableSpot(listing, "E"), false);
});

test("legacy listings fall back to capacity-based letter validation", () => {
  assert.equal(isRentableSpot({ spaces: 1 }, "A"), true);
  assert.equal(isRentableSpot({ spaces: 1 }, "D"), false);
  assert.equal(isRentableSpot({ spaces: 3, spots: [] }, "C"), true);
  assert.equal(isRentableSpot({ spaces: 3, spots: [] }, "D"), false);
  assert.equal(isRentableSpot({}, "A"), true);
});

test("spot labels accept one letter only", () => {
  assert.equal(spotIndexFromLabel(" A "), 0);
  assert.equal(spotIndexFromLabel("D"), 3);
  assert.equal(spotIndexFromLabel("AA"), -1);
  assert.equal(spotIndexFromLabel("1"), -1);
  assert.equal(spotIndexFromLabel(""), -1);
});

test("booking windows overlap only when their occupied time intersects", () => {
  const ten = new Date("2026-08-30T10:00:00Z");
  const eleven = new Date("2026-08-30T11:00:00Z");
  const tenThirty = new Date("2026-08-30T10:30:00Z");
  const elevenThirty = new Date("2026-08-30T11:30:00Z");
  const noon = new Date("2026-08-30T12:00:00Z");

  assert.equal(windowsOverlap(ten, eleven, tenThirty, elevenThirty), true);
  assert.equal(windowsOverlap(ten, noon, tenThirty, eleven), true);
  assert.equal(windowsOverlap(ten, eleven, eleven, noon), false);
});

test("real-time bookings start at payment and last for the requested hours", () => {
  const window = getSessionWindow({
    paid_at: "2026-08-30T10:00:00Z",
    booking_date: null,
    start_hour: null,
    hours: 1.5,
  });

  assert.equal(window.start.toISOString(), "2026-08-30T10:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-08-30T11:30:00.000Z");
  assert.equal(window.isAdvance, false);
});

test("scheduled bookings use the selected date and fractional start hour", () => {
  const window = getSessionWindow({
    paid_at: "2026-08-29T10:00:00Z",
    booking_date: "2026-08-31",
    start_hour: 14.5,
    hours: 2,
  });

  assert.equal(window.start.toISOString(), "2026-08-31T14:30:00.000Z");
  assert.equal(window.end.toISOString(), "2026-08-31T16:30:00.000Z");
  assert.equal(window.isAdvance, true);
});

test("booking totals are calculated in integer cents", () => {
  assert.deepEqual(calculateBookingAmounts(250, 1), {
    hourlyCents: 25000,
    subtotalCents: 25000,
    serviceFeeCents: 3750,
    totalCents: 28750,
  });

  assert.deepEqual(calculateBookingAmounts(10.99, 2), {
    hourlyCents: 1099,
    subtotalCents: 2198,
    serviceFeeCents: 330,
    totalCents: 2528,
  });
});

test("webhook retries do not count as newly inserted bookings", () => {
  assert.equal(isNewWebhookInsert([{ id: 1 }]), true);
  assert.equal(isNewWebhookInsert([]), false);
  assert.equal(isNewWebhookInsert(null), false);
});
