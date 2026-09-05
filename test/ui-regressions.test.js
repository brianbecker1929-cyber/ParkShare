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
  assert.match(chooser, /Last used/);
  assert.match(browseView, /onPreviewRoute\(l\)/);
  assert.doesNotMatch(browseView, /openNavigation\(l\)/);
});

test("confirmed and upcoming bookings can change the saved navigation app", () => {
  const listingDetail = functionSource("ListingDetail", "useAllListings");
  const bookings = functionSource("MyBookingsView", "ReviewModal");

  assert.match(listingDetail, /onNavigateToParking\(listing\)/);
  assert.match(listingDetail, /onChangeNavigationApp\(listing\)/);
  assert.match(bookings, /onNavigateToParking\(b\.listing\)/);
  assert.match(bookings, /onChangeNavigationApp\(b\.listing\)/);
});
