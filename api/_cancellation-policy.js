import { getSessionWindow } from "./_booking-rules.js";

export const DRIVER_CANCELLATION_NOTICE_MS = 60 * 60 * 1000;

const FINAL_CANCELLATION_STATUSES = new Set(["cancelled", "canceled", "refunded"]);
const IN_FLIGHT_REFUND_STATUSES = new Set(["pending", "requires_action"]);
const FAILED_REFUND_STATUSES = new Set(["failed", "canceled"]);

export function evaluateCancellation({ booking, userId, hostId, now = new Date() }) {
  const status = String(booking?.status || "").toLowerCase();
  const refundStatus = String(booking?.refund_status || "").toLowerCase();
  const actor = booking?.renter_id === userId ? "driver" : hostId === userId ? "host" : null;

  if (!actor) {
    return { allowed: false, code: "forbidden", message: "You cannot cancel this booking." };
  }
  if (FINAL_CANCELLATION_STATUSES.has(status)) {
    return { allowed: true, idempotent: true, actor, message: "This booking is already cancelled." };
  }
  if (IN_FLIGHT_REFUND_STATUSES.has(refundStatus)) {
    return { allowed: true, idempotent: true, actor, pending: true, message: "This cancellation refund is already being processed." };
  }
  if (FAILED_REFUND_STATUSES.has(refundStatus)) {
    return { allowed: false, code: "support_required", actor, message: "The refund needs ParkShare support review before it can be retried." };
  }
  if (status !== "confirmed") {
    return { allowed: false, code: "not_confirmed", actor, message: "Only a confirmed booking can be cancelled." };
  }

  const window = getSessionWindow(booking);
  if (!Number.isFinite(window.start.getTime())) {
    return { allowed: false, code: "invalid_window", actor, message: "This booking's start time could not be verified. Please contact support." };
  }
  const noticeMs = window.start.getTime() - new Date(now).getTime();
  if (noticeMs <= 0) {
    return { allowed: false, code: "started", actor, message: "This booking has already started. Please contact support." };
  }

  if (actor === "host") {
    return { allowed: true, actor, fullRefund: true, start: window.start };
  }

  const isScheduled = Boolean(
    String(booking.booking_date || "").match(/^\d{4}-\d{2}-\d{2}/)
    && booking.start_hour !== null
    && booking.start_hour !== undefined
    && booking.start_hour !== ""
  );
  if (!isScheduled) {
    return { allowed: false, code: "book_now", actor, message: "Book Now reservations require ParkShare support review." };
  }
  if (noticeMs < DRIVER_CANCELLATION_NOTICE_MS) {
    return { allowed: false, code: "late", actor, message: "Driver cancellations need at least one hour of notice for an automatic refund." };
  }

  return { allowed: true, actor, fullRefund: true, start: window.start };
}
