import test from "node:test";
import assert from "node:assert/strict";
import { RESTAURANT_CUISINES, buildRestaurantSearchText, normalizeRestaurantPlace } from "../src/lib/restaurants.js";

test("builds restaurant searches from a name or area and selected cuisine", () => {
  assert.equal(buildRestaurantSearchText("Vaughan", "italian_restaurant"), "Vaughan Italian");
  assert.equal(buildRestaurantSearchText("Kinton Ramen", ""), "Kinton Ramen");
  assert.equal(buildRestaurantSearchText("", "thai_restaurant"), "Thai restaurants");
  assert.equal(buildRestaurantSearchText("", ""), "restaurants");
});

test("offers an all-cuisines choice and common cuisine filters", () => {
  assert.equal(RESTAURANT_CUISINES[0].label, "All cuisines");
  assert.ok(RESTAURANT_CUISINES.some(option => option.value === "italian_restaurant"));
  assert.ok(RESTAURANT_CUISINES.some(option => option.value === "vegetarian_restaurant"));
});

test("normalizes Google Place restaurant fields for ParkShare", () => {
  assert.deepEqual(
    normalizeRestaurantPlace({
      id: "place-123",
      displayName: "ParkShare Bistro",
      formattedAddress: "18 Centre Street, Vaughan, ON",
      primaryTypeDisplayName: "Italian restaurant",
      location: { lat: () => 43.8, lng: () => -79.5 },
    }),
    {
      id: "place-123",
      name: "ParkShare Bistro",
      address: "18 Centre Street, Vaughan, ON",
      cuisine: "Italian restaurant",
      lat: 43.8,
      lng: -79.5,
    },
  );
});

test("ignores places without a usable map location", () => {
  assert.equal(normalizeRestaurantPlace({ id: "no-location" }), null);
});
