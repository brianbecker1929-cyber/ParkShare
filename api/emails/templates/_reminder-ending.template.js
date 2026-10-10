import { bookingTicketTemplate } from "./_booking-ticket.template.js";
export default bookingTicketTemplate({
  title: "Parking", accent: "ending soon", preheader: "Your parking session ends in [TIME_REMAINING].",
  name: "[CUSTOMER_FIRST_NAME]", message: "Please return to your vehicle or add time before your reservation ends.",
  status: "Your session is ending soon", reference: "Reservation #[CONFIRMATION_NUMBER]",
  leftLabel: "Time remaining", leftValue: "[TIME_REMAINING]", leftDate: "Return or extend now",
  rightLabel: "Departure / End", rightValue: "[SESSION_END_TIME]", rightDate: "[EXIT_DATE_FULL]",
  primaryLabel: "Add Additional Time", primaryUrl: "[EXTEND_URL]", secondaryLabel: "Get Directions", secondaryUrl: "[DIRECTIONS_URL]",
  actionNote: "Leave the space by [SESSION_END_TIME] unless your extension is confirmed.",
});
