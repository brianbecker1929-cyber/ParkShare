import { MIN_BOOKING_HOURS, MAX_BOOKING_HOURS, isValidBookingDuration } from '../../api/_booking-rules.js';
export { MAX_BOOKING_HOURS };

// Match the existing server rules without replacing what the Driver typed.
export function validateBookingDuration(input) {
  const hours = typeof input === 'number' || typeof input === 'string' && input.trim() !== '' ? Number(input) : NaN;
  let error = '';
  if (!Number.isFinite(hours)) error = 'Enter a booking length from 1 to 744 hours (31 days).';
  else if (hours < MIN_BOOKING_HOURS) error = 'The minimum booking length is 1 hour.';
  else if (hours > MAX_BOOKING_HOURS) error = 'The maximum booking length is 744 hours (31 days).';
  else if (!isValidBookingDuration(hours)) error = 'Choose a duration in 15-minute (0.25 hour) increments.';
  return { hours: error ? null : hours, error };
}
