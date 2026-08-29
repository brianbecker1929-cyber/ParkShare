import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCancellation } from "../api/_cancellation-policy.js";

const DRIVER_ID = "driver";
const HOST_ID = "host";
const NOW = new Date("2026-08-29T10:00:00Z");

function scheduledBooking(overrides = {}) {
  return {
    id: 1,
    renter_id: DRIVER_ID,
    status: "confirmed",
    booking_date: "2026-08-29",
    start_hour: 12,
    hours: 1,
    paid_at: "2026-08-28T10:00:00Z",
    ...overrides,
  };
}

test("Driver cancellation is eligible with more than one hour of notice", () => {
  const result = evaluateCancellation({ booking: scheduledBooking(), userId: DRIVER_ID, hostId: HOST_ID, now: NOW });
  assert.equal(result.allowed, true);
  assert.equal(result.actor, "driver");
  assert.equal(result.fullRefund, true);
});

test("exactly one hour of Driver notice is eligible", () => {
  const result = evaluateCancellation({ booking: scheduledBooking({ start_hour: 11 }), userId: DRIVER_ID, hostId: HOST_ID, now: NOW });
  assert.equal(result.allowed, true);
});

test("less than one hour of Driver notice requires support", () => {
  const result = evaluateCancellation({ booking: scheduledBooking({ start_hour: 10.5 }), userId: DRIVER_ID, hostId: HOST_ID, now: NOW });
  assert.deepEqual({ allowed: result.allowed, code: result.code }, { allowed: false, code: "late" });
});

test("Book Now Driver cancellations require support", () => {
  const booking = scheduledBooking({ booking_date: null, start_hour: null, paid_at: "2026-08-29T10:30:00Z" });
  const result = evaluateCancellation({ booking, userId: DRIVER_ID, hostId: HOST_ID, now: NOW });
  assert.deepEqual({ allowed: result.allowed, code: result.code }, { allowed: false, code: "book_now" });
});

test("Host may cancel any confirmed booking before it starts", () => {
  const result = evaluateCancellation({ booking: scheduledBooking({ start_hour: 10.25 }), userId: HOST_ID, hostId: HOST_ID, now: NOW });
  assert.equal(result.allowed, true);
  assert.equal(result.actor, "host");
});

test("neither party may automatically cancel after the booking starts", () => {
  const result = evaluateCancellation({ booking: scheduledBooking({ start_hour: 9 }), userId: HOST_ID, hostId: HOST_ID, now: NOW });
  assert.deepEqual({ allowed: result.allowed, code: result.code }, { allowed: false, code: "started" });
});

test("unrelated users are forbidden", () => {
  const result = evaluateCancellation({ booking: scheduledBooking(), userId: "stranger", hostId: HOST_ID, now: NOW });
  assert.deepEqual({ allowed: result.allowed, code: result.code }, { allowed: false, code: "forbidden" });
});

test("completed cancellation states and in-flight refunds are idempotent", () => {
  const refunded = evaluateCancellation({ booking: scheduledBooking({ status: "refunded" }), userId: DRIVER_ID, hostId: HOST_ID, now: NOW });
  assert.equal(refunded.idempotent, true);
  const pending = evaluateCancellation({ booking: scheduledBooking({ refund_status: "pending" }), userId: DRIVER_ID, hostId: HOST_ID, now: NOW });
  assert.equal(pending.idempotent, true);
  assert.equal(pending.pending, true);
});

test("a previously failed refund requires support review", () => {
  const result = evaluateCancellation({ booking: scheduledBooking({ refund_status: "failed" }), userId: DRIVER_ID, hostId: HOST_ID, now: NOW });
  assert.deepEqual({ allowed: result.allowed, code: result.code }, { allowed: false, code: "support_required" });
});
