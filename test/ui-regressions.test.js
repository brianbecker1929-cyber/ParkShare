import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return source.slice(start, end);
}

test("host cancellation modal stays inside HostDashboard", () => {
  const hostDashboard = functionSource("HostDashboard", "MessagesView");

  assert.match(hostDashboard, /actor="host"/);
  assert.match(hostDashboard, /onConfirm=\{cancelHostBooking\}/);
});

test("shared DrivewayFrame does not reference host cancellation state", () => {
  const drivewayFrame = functionSource("DrivewayFrame", "SpotPicker");

  assert.doesNotMatch(drivewayFrame, /cancelTarget|cancelBusy|cancelHostBooking/);
});

test("mobile browse defaults to map and listings together", () => {
  const browseView = functionSource("BrowseView", "EditListingModal");

  assert.match(browseView, /const \[view, setView\] = useState\("split"\)/);
});

test("mobile browse stacks the map before full-width listings", () => {
  assert.match(styles, /\.ps-browse-content\s*{\s*flex-direction:\s*column !important;/);
  assert.match(styles, /\.ps-browse-map-column\s*{\s*order:\s*1;/);
  assert.match(styles, /\.ps-browse-listing-column\s*{\s*order:\s*2;\s*width:\s*100% !important;/);
});

test("browse listing cards retain the ParkShare amber treatment", () => {
  assert.match(styles, /\.ps-browse-listing-card\s*{[\s\S]*?background:\s*#FFC107;/);
});

test("mobile full-map mode fills the remaining browse area", () => {
  const browseView = functionSource("BrowseView", "EditListingModal");

  assert.match(browseView, /ps-browse-content-\$\{view\}/);
  assert.match(styles, /\.ps-browse-content-map \.ps-browse-map-column\s*{[\s\S]*?flex:\s*1 1 auto !important;/);
});

test("mobile parking previews include a dismiss control", () => {
  const listingsMap = functionSource("ListingsMap", "MessagingPanel");

  assert.match(listingsMap, /className="ps-mobile-map-listing-close"/);
  assert.match(listingsMap, /aria-label="Close parking preview"/);
  assert.match(listingsMap, /onClick=\{\(\) => onSelect\(null\)\}/);
});

test("route previews use the shared navigation chooser", () => {
  const chooser = functionSource("NavigationChooser", "milesBetween");
  const browseView = functionSource("BrowseView", "EditListingModal");

  assert.match(chooser, /getAvailableNavigationProviders\(\)/);
  assert.match(chooser, /Waze|provider\.label/);
  assert.match(chooser, /\/waze-icon\.webp/);
  assert.match(chooser, /\/google-maps-icon\.webp/);
  assert.match(chooser, /Last used/);
  assert.match(browseView, /onPreviewRoute\(l\)/);
  assert.doesNotMatch(browseView, /openNavigation\(l\)/);
});

test("confirmed and upcoming bookings can change the saved navigation app", () => {
  const listingDetail = functionSource("ListingDetail", "useAllListings");
  const bookings = functionSource("MyBookingsView", "ReviewModal");

  assert.match(listingDetail, /onNavigateToParking\(listing\)/);
  assert.match(listingDetail, /onChangeNavigationApp\(listing\)/);
  assert.match(listingDetail, /ps-booking-navigation-group[\s\S]*?Navigate to parking[\s\S]*?Change app/);
  assert.match(bookings, /onNavigateToParking\(b\.listing\)/);
  assert.match(bookings, /onChangeNavigationApp\(b\.listing\)/);
  assert.match(bookings, /ps-booking-navigation-group[\s\S]*?Navigate to parking[\s\S]*?Change app/);
  assert.doesNotMatch(listingDetail, />Change navigation app</);
  assert.doesNotMatch(bookings, />Change navigation app</);
  assert.match(styles, /\.ps-booking-navigation-group\s*{[\s\S]*?flex-direction:\s*column;/);
});

test("confirmed, upcoming, and active bookings offer rideshare pickup", () => {
  const listingDetail = functionSource("ListingDetail", "useAllListings");
  const bookings = functionSource("MyBookingsView", "ReviewModal");
  const rideshare = functionSource("RidesharePickupCard", "milesBetween");

  assert.match(listingDetail, /<RidesharePickupCard listing=\{listing\}/);
  assert.match(bookings, /<RidesharePickupCard listing=\{b\.listing\}/);
  assert.match(bookings, /displayStatus === "Upcoming" \|\| displayStatus === "Active"/);
  assert.match(rideshare, /\/rideshare\/uber-logo\.png/);
  assert.match(rideshare, /\/rideshare\/lyft-logo\.png/);
  assert.match(rideshare, /computeDrivingRoute/);
  assert.match(rideshare, /Estimated arrival/);
  assert.match(rideshare, /Approximately \{RIDESHARE_PICKUP_BUFFER_MINUTES\} minutes after arrival/);
  assert.match(rideshare, /Confirm the pickup time, ride, fare, and payment/);
  assert.match(styles, /\.ps-rideshare-provider\.is-uber img\s*\{[^}]*width:\s*112px/);
  assert.match(styles, /\.ps-rideshare-provider\.is-lyft img\s*\{[^}]*height:\s*39px/);
});

test("booking cards show start times and collapse completed or cancelled bookings", () => {
  const bookings = functionSource("MyBookingsView", "ReviewModal");
  const bookingDisplay = functionSource("clientBookingDisplay", "requestBookingCancellation");
  const bookingSchedule = functionSource("BookingSchedule", "buildAppUser");

  assert.match(bookings, /<BookingSchedule[\s\S]*?date=\{b\.date\}[\s\S]*?startTime=\{b\.startTime\}[\s\S]*?duration=\{b\.duration\}/);
  assert.match(bookingSchedule, />Date<[\s\S]*?>Starts<[\s\S]*?>Duration</);
  assert.match(bookingSchedule, />Time remaining</);
  assert.match(bookingSchedule, /formatBookingTimeRemaining\(bookingEnd, currentTime\)/);
  assert.match(bookingDisplay, /hour12:\s*true/);
  assert.match(bookingDisplay, /toLocaleTimeString\("en-CA", timeOptions\)/);
  assert.match(bookings, /displayStatus === "Completed" \|\| displayStatus === "Cancelled"/);
  assert.match(bookings, /className="ps-past-booking-toggle"/);
  assert.match(bookings, /aria-expanded=\{isExpanded\}/);
  assert.match(bookings, /isRideshareEligible = !hasEnded/);
  assert.match(bookings, /\{isRideshareEligible && <RidesharePickupCard/);
  assert.match(styles, /\.ps-driver-booking-card\.is-collapsed/);
});

test("Host upcoming bookings show the reservation start time", () => {
  const hostDashboard = functionSource("HostDashboard", "MessagesView");
  const bookingDisplay = functionSource("clientBookingDisplay", "requestBookingCancellation");

  assert.match(hostDashboard, /const display = clientBookingDisplay\(window\.start, scheduled\)/);
  assert.match(hostDashboard, /<BookingSchedule[\s\S]*?date=\{b\.date\}[\s\S]*?startTime=\{b\.startTime\}[\s\S]*?duration=\{b\.duration\}/);
  assert.match(hostDashboard, /isActive=\{b\.displayStatus === "Active"\}/);
  assert.match(bookingDisplay, /hour12:\s*true/);
  assert.match(bookingDisplay, /toLocaleTimeString\("en-CA", timeOptions\)/);
  assert.match(styles, /\.ps-booking-schedule\s*{[\s\S]*?background:\s*#0E1B2E/);
  assert.match(styles, /\.ps-booking-schedule-cell\.is-remaining\s*{[\s\S]*?background:\s*#FFC107/);
});
