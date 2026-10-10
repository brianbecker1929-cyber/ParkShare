import { bookingTicketTemplate } from "./_booking-ticket.template.js";
export default bookingTicketTemplate({
  title: "Extra time", accent: "confirmed!", preheader: "Your extension is confirmed. New departure: [NEW_END_TIME].",
  name: "[CUSTOMER_FIRST_NAME]", message: "Your extension is paid and your space is reserved longer.",
  status: "Extension confirmed", reference: "Reservation #[CONFIRMATION_NUMBER]",
  leftLabel: "Time added", leftValue: "+[ADDED_TIME]", leftDate: "Same space · [SPOT_LABEL]",
  rightLabel: "New departure", rightValue: "[NEW_END_TIME]", rightDate: "[NEW_END_DATE_FULL]", payment: true,
  primaryLabel: "View Booking", primaryUrl: "[MANAGE_RESERVATION_URL]", secondaryLabel: "Add More Time", secondaryUrl: "[EXTEND_URL]",
  actionNote: "Your booking now ends at [NEW_END_TIME].",
});
