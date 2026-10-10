import { bookingTicketTemplate } from "./_booking-ticket.template.js";
export default bookingTicketTemplate({
  title: "Halfway", accent: "check-in", preheader: "Halfway through your parking session — [TIME_REMAINING] remaining.",
  name: "[CUSTOMER_FIRST_NAME]", message: "You're halfway through your stay. Plan the rest of your session below.",
  status: "Halfway through your session", reference: "Reservation #[CONFIRMATION_NUMBER]",
  leftLabel: "Time remaining", leftValue: "[TIME_REMAINING]", leftDate: "Halfway check-in",
  rightLabel: "Departure / End", rightValue: "[SESSION_END_TIME]", rightDate: "[EXIT_DATE_FULL]",
  primaryLabel: "Add Additional Time", primaryUrl: "[EXTEND_URL]", secondaryLabel: "View Booking", secondaryUrl: "[MANAGE_RESERVATION_URL]",
  actionNote: "Need a longer stay? Add time before your booking ends.",
});
