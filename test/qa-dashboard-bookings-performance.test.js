import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { publicListingCoverUrl } from "../src/lib/publicListings.js";
import { isListingImageUrl } from "../src/lib/listingPhotos.js";

const readApp = () => readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("Host Dashboard projects only lightweight owned listings", async () => {
  const app = await readApp();
  const start = app.indexOf("function HostDashboard(");
  const end = app.indexOf("function DrivewayFrame(", start);
  assert.ok(start >= 0 && end > start);
  const host = app.slice(start, end);
  assert.match(host, /\.from\("listings"\)\s*\.select\("id, title, address, price, description, features, spaces, spots"\)\s*\.eq\("host_id", user\.id\)/);
  assert.doesNotMatch(host, /\.from\("listings"\)\s*\.select\("\*"\)/);
  assert.match(host, /img: publicListingCoverUrl\(row\.id\) \|\| "🏠"/);
  assert.doesNotMatch(host, /img: row\.img/);
});

test("Host booking queries exclude huge joined listing photos but keep reservation details", async () => {
  const app = await readApp();
  const start = app.indexOf("function HostDashboard(");
  const end = app.indexOf("function DrivewayFrame(", start);
  const host = app.slice(start, end);
  assert.ok(host.includes('.select("*, listings(id, title, address, lat, lng, spots, spaces), profiles(name)")'));
  assert.doesNotMatch(host, /listings\(\*\)/);
  assert.match(host, /img: publicListingCoverUrl\(row\.listing_id\)/);
  assert.match(host, /photos: \[\]/);
  assert.match(host, /bookingEventFromRow\(row\)/);
  assert.match(host, /row\.vehicle_make/);
  assert.match(host, /row\.refund_status/);
});

test("Driver My Bookings excludes embedded legacy photos without losing Host name or booked spot", async () => {
  const app = await readApp();
  const start = app.indexOf("function MyBookingsView(");
  const end = app.indexOf("// Scroll to and briefly highlight", start);
  const driver = app.slice(start, end);
  assert.ok(driver.includes('.select("*, listings(id, title, address, lat, lng, spots, spaces, description, profiles(name))")'));
  assert.doesNotMatch(driver, /listings\(\*/);
  assert.match(driver, /img: publicListingCoverUrl\(row\.listing_id\)/);
  assert.match(driver, /row\.listings\?\.profiles\?\.name/);
  assert.match(driver, /photos: \[\]/);
  assert.match(driver, /row\.spot_label/);
  assert.match(driver, /row\.refund_status/);
});

test("new image source preserves legacy and Storage listing covers as separate requests", () => {
  assert.equal(publicListingCoverUrl(17), "/api/listing-cover?listingId=17");
  assert.equal(isListingImageUrl(publicListingCoverUrl(17)), true);
  assert.equal(publicListingCoverUrl(0), null);
});
