import { bookingTicketTemplate } from "./_booking-ticket.template.js";
export default bookingTicketTemplate({
  title: "Booking", accent: "confirmed!", preheader: "Your parking space is reserved — [SPOT_LABEL].",
  name: "[CUSTOMER_FIRST_NAME]", message: "Your space is reserved. Here are your parking details.",
  status: "Reservation confirmed", reference: "Confirmation #[CONFIRMATION_NUMBER]",
  leftLabel: "Arrival / Start", leftValue: "[SESSION_START_TIME]", leftDate: "[ENTRY_DATE_FULL]",
  rightLabel: "Departure / End", rightValue: "[SESSION_END_TIME]", rightDate: "[EXIT_DATE_FULL]",
  payment: true, paymentLabel: "Total charged",
  primaryLabel: "Get Directions", primaryUrl: "[DIRECTIONS_URL]", secondaryLabel: "View Booking", secondaryUrl: "[MANAGE_RESERVATION_URL]",
  actionNote: "Park in [SPOT_LABEL] during your reserved time.",
});
