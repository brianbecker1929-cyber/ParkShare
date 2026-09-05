import test from "node:test";
import assert from "node:assert/strict";

import {
  NAVIGATION_PREFERENCE_KEY,
  buildNavigationUrl,
  getAvailableNavigationProviders,
  getPreferredNavigationProvider,
  savePreferredNavigationProvider,
} from "../src/lib/navigation.js";

test("Google Maps route links prefer exact listing coordinates", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent", 43.6532, -79.3832, "Mozilla/5.0 (Linux; Android 16)"),
    "https://www.google.com/maps/dir/?api=1&destination=43.6532%2C-79.3832&travelmode=driving",
  );
});

test("Apple Maps route links are used on iOS", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent", 43.6532, -79.3832, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"),
    "https://maps.apple.com/?daddr=43.6532%2C-79.3832&dirflg=d",
  );
});

test("route links fall back to the encoded listing address", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent, Toronto, ON", null, null, "Desktop"),
    "https://www.google.com/maps/dir/?api=1&destination=24%20Horwood%20Crescent%2C%20Toronto%2C%20ON&travelmode=driving",
  );
});

test("an explicit Google Maps choice is respected on iOS", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent", 43.6532, -79.3832, "Mozilla/5.0 (iPhone)", "google"),
    "https://www.google.com/maps/dir/?api=1&destination=43.6532%2C-79.3832&travelmode=driving",
  );
});

test("Waze route links prefer exact listing coordinates", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent", 43.6532, -79.3832, "Mozilla/5.0 (Linux; Android 16)", "waze"),
    "https://waze.com/ul?ll=43.6532%2C-79.3832&navigate=yes&utm_source=parkshare",
  );
});

test("Waze route links fall back to the encoded listing address", () => {
  assert.equal(
    buildNavigationUrl("24 Horwood Crescent, Toronto, ON", null, null, "Desktop", "waze"),
    "https://waze.com/ul?q=24%20Horwood%20Crescent%2C%20Toronto%2C%20ON&navigate=yes&utm_source=parkshare",
  );
});

test("Apple Maps is offered only on supported Apple devices", () => {
  assert.deepEqual(
    getAvailableNavigationProviders("Mozilla/5.0 (Linux; Android 16)").map(provider => provider.id),
    ["waze", "google"],
  );
  assert.deepEqual(
    getAvailableNavigationProviders("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)").map(provider => provider.id),
    ["waze", "google", "apple"],
  );
});

test("the most recently selected navigation provider can be remembered", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(getPreferredNavigationProvider(storage), null);
  assert.equal(savePreferredNavigationProvider("waze", storage), true);
  assert.equal(values.get(NAVIGATION_PREFERENCE_KEY), "waze");
  assert.equal(getPreferredNavigationProvider(storage), "waze");
  assert.equal(savePreferredNavigationProvider("unsupported", storage), false);
});
