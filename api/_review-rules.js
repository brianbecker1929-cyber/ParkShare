// A review is valid only after a real paid parking session has ended.
// Reject pending/refunded/partially-refunded/disputed reservations, even
// when a driver knows a valid listing ID. Do not trust client "completed".
import { getSessionWindow } from "./_booking-rules.js";

export function eligibleForReview(booking, now = new Date()) {
  if (!booking?.paid_at || !booking?.stripe_checkout_session_id) return false;
  if (!["confirmed", "completed"].includes(booking.status)) return false;
  try {
    const { end } = getSessionWindow(booking);
    return Number.isFinite(end.getTime()) && end.getTime() <= now.getTime();
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
