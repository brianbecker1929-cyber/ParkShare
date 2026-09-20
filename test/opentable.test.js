import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenTableWidgetUrl, parseOpenTableRestaurantMap, resolveOpenTableRestaurantId } from "../src/lib/opentable.js";

test("parses an OpenTable restaurant-id map without throwing on bad configuration", () => {
  assert.deepEqual(parseOpenTableRestaurantMap('{"place-123":"108955"}'), { "place-123": "108955" });
  assert.deepEqual(parseOpenTableRestaurantMap("not-json"), {});
});

test("resolves OpenTable restaurant IDs by Google place id, name/address, or direct restaurant data", () => {
  const restaurant = {
    id: "place-123",
    name: "ParkShare Bistro",
    address: "18 Centre Street, Vaughan, ON",
  };

  assert.equal(resolveOpenTableRestaurantId({ ...restaurant, openTableRid: "55555" }, {}), "55555");
  assert.equal(resolveOpenTableRestaurantId(restaurant, { "place-123": "108955" }), "108955");
  assert.equal(resolveOpenTableRestaurantId(restaurant, { "parkshare bistro": "108956" }), "108956");
  assert.equal(
    resolveOpenTableRestaurantId(restaurant, { "parkshare bistro|18 centre street vaughan on": "108957" }),
    "108957",
  );
});

test("builds a Canadian same-page OpenTable reservation-widget URL", () => {
  const url = buildOpenTableWidgetUrl("108955");
  assert.match(url, /^https:\/\/www\.opentable\.ca\/widget\/reservation\/canvas\?/);
  assert.match(url, /rid=108955/);
  assert.match(url, /domain=ca/);
  assert.match(url, /newtab=false/);
  assert.equal(buildOpenTableWidgetUrl("not-a-rid"), "");
});
