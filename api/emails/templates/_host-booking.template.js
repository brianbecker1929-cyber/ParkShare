import { bookingTicketTemplate } from "./_booking-ticket.template.js";
export default bookingTicketTemplate({
  title: "New booking", accent: "confirmed!", preheader: "A driver has reserved [SPOT_LABEL]. See the vehicle and arrival time.",
  name: "[HOST_NAME]", message: "A driver has reserved your driveway.",
  status: "New driveway reservation", reference: "Confirmation #[BOOKING_NUMBER]",
  addressLabel: "Your property", address: "[PROPERTY_ADDRESS]",
  portrait: "[HOST_PORTRAIT_URL]", portraitAlt: "William welcoming a new ParkShare host reservation",
  leftLabel: "Arrival / Start", leftValue: "[HOST_START_TIME]", leftDate: "[HOST_START_DATE]",
  rightLabel: "Departure / End", rightValue: "[HOST_END_TIME]", rightDate: "[HOST_END_DATE]",
  payment: true, paymentLabel: "Total charged to Driver",
  partyLabel: "Driver", partyName: "[DRIVER_NAME]", location: false,
  vehicleLabel: "Vehicle to expect", vehicle: "[VEHICLE_DETAILS]", plate: "[VEHICLE_PLATE]",
  primaryLabel: "Open Host Dashboard", primaryUrl: "[HOST_DASHBOARD_URL]", actionNote: "View reservations and manage listings.",
});
