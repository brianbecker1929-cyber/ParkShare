export const EVENT_SUBMISSION_CATEGORIES = new Set(["concert", "sports", "festival", "theatre", "community"]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function optionalUrl(value) {
  const clean = text(value, 1000);
  if (!clean) return "";
  try {
    const url = new URL(clean);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function validateEventSubmission(input = {}, today = new Date()) {
  const ticketUrl = optionalUrl(input.ticketUrl);
  const eventUrl = optionalUrl(input.eventUrl);
  const value = {
    organizer_name: text(input.organizerName, 120),
    organizer_email: text(input.organizerEmail, 254).toLowerCase(),
    organizer_phone: text(input.organizerPhone, 40),
    event_name: text(input.eventName, 180),
    category: text(input.category, 40),
    venue_name: text(input.venueName, 180),
    address: text(input.address, 300),
    event_date: text(input.eventDate, 10),
    start_time: text(input.startTime, 5),
    end_time: text(input.endTime, 5),
    description: text(input.description, 5000),
    ticket_url: ticketUrl,
    event_url: eventUrl,
    access_notes: text(input.accessNotes, 2000),
  };

  if (!value.organizer_name || !EMAIL_PATTERN.test(value.organizer_email)) return { error: "Please provide a valid organizer name and email address." };
  if (!value.event_name || !value.venue_name || !value.address || !value.description) return { error: "Please complete the required event details." };
  if (!EVENT_SUBMISSION_CATEGORIES.has(value.category)) return { error: "Please select a valid event category." };
  if (!DATE_PATTERN.test(value.event_date) || !TIME_PATTERN.test(value.start_time) || (value.end_time && !TIME_PATTERN.test(value.end_time))) return { error: "Please provide a valid event date and time." };
  const todayIso = new Date(today).toISOString().slice(0, 10);
  if (value.event_date < todayIso) return { error: "The event date must be today or later." };
  if (ticketUrl === null || eventUrl === null) return { error: "Event and ticket links must begin with http:// or https://." };
  if (input.authorized !== true) return { error: "Please confirm that you are authorized to submit this event." };

  return { value };
}

