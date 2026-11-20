import { bookingTicketTemplate } from "./_booking-ticket.template.js";
export default bookingTicketTemplate({
  header: "extension",
  title: "Parking extended", accent: "confirmed!", preheader: "Your Driver added [ADDED_TIME]. New departure: [NEW_END_TIME].",
  name: "[HOST_NAME]", message: "[DRIVER_NAME] has paid for extra time in your driveway.",
  status: "Parking extension confirmed", reference: "Reservation #[CONFIRMATION_NUMBER]",
  addressLabel: "Your property",
  portrait: "[HOST_PORTRAIT_URL]", portraitAlt: "William supporting ParkShare Hosts",
  leftLabel: "Time added", leftValue: "+[ADDED_TIME]", leftDate: "Same space · [SPOT_LABEL]",
  rightLabel: "New departure", rightValue: "[NEW_END_TIME]", rightDate: "[NEW_END_DATE_FULL]",
  partyLabel: "Driver", partyName: "[DRIVER_NAME]", location: false,
  vehicleLabel: "Vehicle to expect",
  payment: true, paymentLabel: "Extension charged to Driver",
  primaryLabel: "Open Host Dashboard", primaryUrl: "[HOST_DASHBOARD_URL]",
  actionNote: "This is the Driver's extension charge, not your payout. The reservation now ends at [NEW_END_TIME].",
  messageLabel: "Message Driver",
});
