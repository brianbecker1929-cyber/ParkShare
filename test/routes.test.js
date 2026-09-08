import test from "node:test";
import assert from "node:assert/strict";

import { PARKSHARE_ROUTES, getRouteForState, getRouteFromPath, normalizePathname } from "../src/lib/routes.js";

test("every ParkShare screen has a unique durable path", () => {
  const paths = PARKSHARE_ROUTES.map(route => route.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(getRouteForState("app", "Browse").path, "/parking");
  assert.equal(getRouteForState("app", "My Bookings").path, "/my-bookings");
  assert.equal(getRouteForState("host").path, "/hosts");
  assert.equal(getRouteForState("legal", "Browse", "privacy").path, "/privacy");
});

test("refreshing or opening a deep link restores its screen and tab", () => {
  assert.deepEqual(
    { screen: getRouteFromPath("/host-dashboard").screen, tab: getRouteFromPath("/host-dashboard").tab },
    { screen: "app", tab: "Host Dashboard" },
  );
  assert.deepEqual(
    { screen: getRouteFromPath("/about/").screen, tab: getRouteFromPath("/about/").tab },
    { screen: "about", tab: undefined },
  );
  assert.equal(normalizePathname("//DISCOVER//"), "/discover");
});

test("account routes are excluded from search indexing", () => {
  for (const path of ["/my-bookings", "/messages", "/profile", "/host-dashboard", "/transactions"]) {
    assert.equal(getRouteFromPath(path).private, true);
  }
  assert.equal(getRouteFromPath("/parking").private, undefined);
});
