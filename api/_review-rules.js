// Pure review eligibility and input rules; never trust client "completed".
import { getSessionWindow, isValidBookingDuration } from "./_booking-rules.js";

function hasValidScheduledWindow(booking) {
  const dateSupplied = booking.booking_date != null && booking.booking_date !== "";
  const hourSupplied = booking.start_hour != null && booking.start_hour !== "";
  // A half-populated future booking is never evidence of an ended stay.
  if (dateSupplied !== hourSupplied) return false;
  if (!dateSupplied) return true;
  const localDate = String(booking.booking_date);
  const hour = Number(booking.start_hour);
  const dateValid = /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(localDate)
    && !Number.isNaN(new Date(localDate.slice(0, 10) + "T00:00:00Z").getTime());
  return dateValid && Number.isFinite(hour) && hour >= 0 && hour < 24
    && Math.abs(hour * 4 - Math.round(hour * 4)) < 1e-9;
}

export function eligibleForReview(booking, now = new Date()) {
  if (!booking || !["confirmed", "completed"].includes(booking.status)) return false;
  if (typeof booking.stripe_checkout_session_id !== "string"
      || !booking.stripe_checkout_session_id.trim()) return false;
  const paidAt = new Date(booking.paid_at);
  if (booking.paid_at == null || !Number.isFinite(paidAt.getTime())
      || !Number.isFinite(now?.getTime?.()) || paidAt.getTime() > now.getTime()) return false;
  if (!isValidBookingDuration(booking.hours, { scheduled: !!booking.booking_date })
      || !hasValidScheduledWindow(booking)) return false;
  try {
    const { start, end } = getSessionWindow(booking);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
      && end.getTime() > start.getTime() && end.getTime() <= now.getTime();
  } catch {
    return false;
  }
}

export function validateReviewInput({ listingId, rating, text }) {
  const id = Number(listingId);
  const star = Number(rating);
  const body = typeof text === "string" ? text.trim() : "";
  if (!Number.isSafeInteger(id) || id <= 0) return "Valid listing required.";
  if (!Number.isInteger(star) || star < 1 || star > 5) return "Choose 1–5 stars.";
  if (body.length < 3 || body.length > 1500) return "Review must be 3–1500 characters.";
  return null;
}
