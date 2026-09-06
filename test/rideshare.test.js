import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRideshareUrl,
  formatSuggestedPickupTime,
  getSuggestedPickupDate,
  RIDESHARE_PICKUP_BUFFER_MINUTES,
} from "../src/lib/rideshare.js";

const listing = {
  title: "Downtown Toronto parking",
  address: "24 Horwood Crescent, Toronto, ON",
  lat: 43.6532,
  lng: -79.3832,
};

test("Uber ride links prefill the confirmed ParkShare location", () => {
  const url = new URL(buildRideshareUrl("uber", listing, { uberClientId: "parkshare-client" }));
  const pickup = JSON.parse(url.searchParams.get("pickup"));

  assert.equal(url.origin + url.pathname, "https://m.uber.com/looking");
  assert.equal(url.searchParams.get("client_id"), "parkshare-client");
  assert.equal(pickup.latitude, listing.lat);
  assert.equal(pickup.longitude, listing.lng);
  assert.equal(pickup.addressLine2, listing.address);
});

test("Lyft ride links prefill the confirmed ParkShare coordinates", () => {
  const url = new URL(buildRideshareUrl("lyft", listing, { lyftClientId: "parkshare-client" }));

  assert.equal(url.origin + url.pathname, "https://ride.lyft.com/u");
  assert.equal(url.searchParams.get("partner"), "parkshare-client");
  assert.equal(url.searchParams.get("pickup[latitude]"), String(listing.lat));
  assert.equal(url.searchParams.get("pickup[longitude]"), String(listing.lng));
});

test("ride links fall back to the provider when coordinates are unavailable", () => {
  assert.equal(buildRideshareUrl("uber", { address: listing.address }), "https://m.uber.com/looking");
  assert.equal(buildRideshareUrl("lyft", { address: listing.address }), "https://ride.lyft.com/u");
  assert.equal(buildRideshareUrl("uber", { ...listing, lat: null, lng: null }), "https://m.uber.com/looking");
});

test("suggested pickup is five minutes after estimated arrival", () => {
  assert.equal(RIDESHARE_PICKUP_BUFFER_MINUTES, 5);
  assert.equal(getSuggestedPickupDate("2026-09-12T18:00:00Z").toISOString(), "2026-09-12T18:05:00.000Z");
  assert.match(formatSuggestedPickupTime("2026-09-12T18:00:00Z", "en-CA", { timeZone: "UTC" }), /6:05/);
});

test("arrival-based pickup displays in the Driver's local timezone", () => {
  const displayed = formatSuggestedPickupTime(
    "2026-09-06T03:36:00Z",
    "en-CA",
    { timeZone: "America/Toronto" },
  );

  assert.match(displayed, /11:41/);
  assert.doesNotMatch(displayed, /3:41/);
});

test("pickup times can still be formatted in an explicit timezone", () => {
  const displayed = formatSuggestedPickupTime(
    "2026-09-12T09:00:00Z",
    "en-CA",
    { timeZone: "UTC" },
  );

  assert.match(displayed, /9:05/);
  assert.equal(formatSuggestedPickupTime(null), "");
});
