import test from "node:test";
import assert from "node:assert/strict";

import { buildNavigationUrl } from "../src/lib/navigation.js";

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
