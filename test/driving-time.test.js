import test from "node:test";
import assert from "node:assert/strict";
import { computeDrivingRoute, getEstimatedArrivalDate } from "../src/lib/drivingTime.js";

test("estimated arrival adds the traffic-aware driving duration to the current time", () => {
  assert.equal(
    getEstimatedArrivalDate("2026-09-06T16:00:00Z", 24).toISOString(),
    "2026-09-06T16:24:00.000Z",
  );
  assert.equal(getEstimatedArrivalDate("invalid", 24), null);
});

test("requests a traffic-aware driving route from the Driver to the parking spot", async () => {
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
                    rows: [{ items: [{ condition: "ROUTE_EXISTS", durationMillis: 1_260_001, distanceMeters: 14_800 }] }],
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
    const route = await computeDrivingRoute(
      { lat: 43.78, lng: -79.55 },
      { lat: 43.81, lng: -79.49 },
    );

    assert.equal(capturedRequest.travelMode, "DRIVING");
    assert.equal(capturedRequest.routingPreference, "TRAFFIC_AWARE");
    assert.deepEqual(capturedRequest.origins, [{ lat: 43.78, lng: -79.55 }]);
    assert.deepEqual(capturedRequest.destinations, [{ lat: 43.81, lng: -79.49 }]);
    assert.deepEqual(route, { minutes: 22, distanceMeters: 14_800 });
  } finally {
    delete globalThis.window;
  }
});
