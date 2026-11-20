import {EVENT_CATEGORIES} from './events.js';
import {isCalendarDate} from './availabilityExceptionDates.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = value => typeof value === 'string' ? value.trim() : '';
function validOptionalUrl(value) {
  if (!clean(value)) return true;
  try { return ['http:', 'https:'].includes(new URL(clean(value)).protocol); } catch { return false; }
}

// Client field errors complement the server's independent review-queue validation.
export function validateEventSubmissionForm(form, now = new Date()) {
  const errors = {};
  for (const [field, message] of Object.entries({organizerName: 'Please enter the organizer or organization name.', eventName: 'Please enter the event name.', venueName: 'Please enter the venue name.', address: 'Please enter the full event address.', description: 'Please enter an event description.'})) {
    if (!clean(form[field])) errors[field] = message;
  }
  if (!emailPattern.test(clean(form.organizerEmail))) errors.organizerEmail = 'Please enter a valid organizer email address.';
  if (!EVENT_CATEGORIES.some(option => option.value && option.value === form.category)) errors.category = 'Please select a valid event category.';
  if (!isCalendarDate(form.eventDate)) errors.eventDate = 'Please enter a valid event date.';
  else if (form.eventDate < new Date(now).toISOString().slice(0, 10)) errors.eventDate = 'The event date must be today or later.';
  if (!timePattern.test(form.startTime || '')) errors.startTime = 'Please enter a valid start time.';
  if (form.endTime && !timePattern.test(form.endTime)) errors.endTime = 'Please enter a valid end time, or leave it blank.';
  for (const [field, label] of [['ticketUrl', 'Ticket links'], ['eventUrl', 'Event links']]) {
    if (!validOptionalUrl(form[field])) errors[field] = label + ' must begin with http:// or https://.';
  }
  if (form.authorized !== true) errors.authorized = 'Please confirm that you are authorized to submit this event.';
  return errors;
}
