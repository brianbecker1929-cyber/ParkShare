import {resolveLocalBookingEnd, resolveLocalBookingWindow} from '../../api/_booking-local-time.js';
import {validateBookingDuration} from './bookingDuration.js';

export function validateScheduledBooking(selection) {
  try {
    const window = resolveLocalBookingWindow(selection);
    return {...validateBookingDuration(window.hours), window};
  } catch (error) {
    return {hours: null, error: error.message || 'Choose valid times in the parking property’s time zone.', window: null};
  }
}

// Missing spring times and repeated autumn times cannot identify one instant.
// Keep them visible but disabled, including end times on the following day.
export function invalidScheduledHours({bookingDate, timeZone}) {
  const invalid = new Set();
  // Missing/invalid property metadata is explained by validation, rather
  // than incorrectly labelling every clock time as a DST transition.
  if (typeof timeZone !== 'string' || !timeZone.trim()) return invalid;
  try { new Intl.DateTimeFormat('en', {timeZone}); } catch { return invalid; }
  for (let quarter = 0; quarter < 192; quarter++) {
    const hour = quarter / 4;
    try { resolveLocalBookingEnd({bookingDate, endHour: hour, timeZone}); }
    catch { invalid.add(hour); }
  }
  return invalid;
}
