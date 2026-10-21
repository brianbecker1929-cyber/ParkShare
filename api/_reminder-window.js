import { getSessionWindow } from "./_booking-rules.js";

export function dueReminder(booking, now = Date.now()) {
  const { start, end } = getSessionWindow(booking);
  const startMs = start.getTime(), endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new RangeError("Invalid reminder session window");
  }
  if (booking.status !== "confirmed" || !booking.paid_at || now < startMs || now >= endMs) return null;
  if (now >= endMs - 15 * 60_000) return booking.reminder_ending_sent_at ? null : { kind: "ending", end: endMs };
  if (now >= startMs + (endMs - startMs) / 2 && !booking.reminder_halfway_sent_at) return { kind: "halfway", end: endMs };
  return null;
}
