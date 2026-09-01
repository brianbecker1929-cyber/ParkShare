import test from "node:test";
import assert from "node:assert/strict";
import { buildWalkingLabel, computeWalkingRoutes, estimateWalkingMinutes } from "../src/lib/walkingTime.js";

test("estimates walking minutes from the existing straight-line distance", () => {
  assert.equal(estimateWalkingMinutes(1), 20);
  assert.equal(estimateWalkingMinutes(0), 1);
  assert.equal(estimateWalkingMinutes(null), null);
});

test("shows an accurate route-matrix walking label when routing succeeds", () => {
  assert.equal(
    buildWalkingLabel({
      destinationSelected: true,
      loading: false,
      route: { minutes: 7, distanceMeters: 620 },
      distanceMiles: 0.3,
    }),
    "🚶 7 min walk · 0.6 km",
  );
});

test("marks straight-line walking times as approximate when routing is unavailable", () => {
  assert.equal(
    buildWalkingLabel({
      destinationSelected: true,
      loading: false,
      route: null,
      distanceMiles: 1,
    }),
    "🚶 ≈ 20 min walk · 1.6 km",
  );
});

test("does not claim a walking time until a destination is selected", () => {
  assert.equal(
    buildWalkingLabel({
      destinationSelected: false,
      loading: false,
      route: null,
      distanceMiles: 1,
    }),
    null,
  );
});

test("requests pedestrian route metrics from every driveway to the selected destination", async () => {
  let capturedRequest;
  globalThis.window = {
    google: {
      maps: {
        importLibrary: async name => {
          assert.equal(name, "routes");
          return {
            RouteMatrix: {
              computeRouteMatrix: async request => {
                capturedRequest = request;
                return {
                  matrix: {
                    rows: [
                      { items: [{ condition: "ROUTE_EXISTS", durationMillis: 360000, distanceMeters: 480 }] },
                      { items: [{ condition: "ROUTE_EXISTS", durationMillis: 720000, distanceMeters: 950 }] },
                    ],
                  },
                };
              },
            },
          };
        },
      },
    },
  };

  try {
    const result = await computeWalkingRoutes(
      [
        { id: "one", lat: 43.8, lng: -79.5 },
        { id: "two", lat: 43.81, lng: -79.49 },
      ],
      { lat: 43.79, lng: -79.45 },
    );

    assert.equal(capturedRequest.travelMode, "WALKING");
    assert.deepEqual(capturedRequest.destinations, [{ lat: 43.79, lng: -79.45 }]);
    assert.deepEqual(result, {
      one: { minutes: 6, distanceMeters: 480 },
      two: { minutes: 12, distanceMeters: 950 },
    });
  } finally {
    delete globalThis.window;
  }
});
