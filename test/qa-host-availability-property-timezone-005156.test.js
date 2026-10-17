import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createAvailabilityPreset,
  isListingAvailableForWindow,
} from "../src/lib/listingAvailability.js";

test("Host schedule uses the verified parking-property zone, not travelling Host device", () => {
  // The Host set Monday–Friday, 9–5 while visiting Greece, so the stored
  // preset timezone is Greece even though the driveway is in Vancouver.
  const hostSchedule = createAvailabilityPreset("business", "Europe/Athens");
  const nineFifteenPacific = ["2026-10-20T16:15:00Z", "2026-10-20T16:45:00Z"];
  assert.equal(isListingAvailableForWindow(hostSchedule, ...nineFifteenPacific), false);
  assert.equal(
    isListingAvailableForWindow(hostSchedule, ...nineFifteenPacific, "America/Vancouver"),
    true
  );
  assert.equal(hostSchedule.timezone, "Europe/Athens", "do not modify the saved Host schedule object");

  // Conversely, 9:15 Toronto is 6:15 Vancouver: a nonlocal preset must not
  // accidentally open the Vancouver driveway before its 9am local schedule.
  const torontoPreset = createAvailabilityPreset("business", "America/Toronto");
  const sixFifteenPacific = ["2026-10-20T13:15:00Z", "2026-10-20T13:45:00Z"];
  assert.equal(isListingAvailableForWindow(torontoPreset, ...sixFifteenPacific), true);
  assert.equal(
    isListingAvailableForWindow(torontoPreset, ...sixFifteenPacific, "America/Vancouver"),
    false
  );
});

test("property-zone schedule check respects summer/winter offsets", () => {
  const schedule = createAvailabilityPreset("business", "America/Toronto");
  for (const [start, end] of [
    ["2026-10-20T16:15:00Z", "2026-10-20T16:45:00Z"], // 9:15am Vancouver PDT
    ["2026-12-15T17:15:00Z", "2026-12-15T17:45:00Z"], // 9:15am Vancouver PST
  ]) {
    assert.equal(isListingAvailableForWindow(schedule, start, end, "America/Vancouver"), true);
  }
});

test("invalid property timezone fails closed; legacy no-zone behavior is preserved", () => {
  const schedule = createAvailabilityPreset("business", "America/Toronto");
  const start = "2026-10-20T13:15:00Z", end = "2026-10-20T13:45:00Z";
  assert.throws(() => isListingAvailableForWindow(schedule, start, end, "Fake/Zone"), RangeError);
  assert.throws(() => isListingAvailableForWindow(schedule, start, end, ""), RangeError);
  assert.equal(isListingAvailableForWindow(schedule, start, end), true);
  assert.equal(isListingAvailableForWindow(schedule, start, end, null), true);
});

test("both checkout and availability pass database-trusted property zone to Host hours", async () => {
  const [checkout, availability] = await Promise.all([
    readFile(new URL("../api/create-checkout-session.js", import.meta.url), "utf8"),
    readFile(new URL("../api/listing-availability.js", import.meta.url), "utf8"),
  ]);
  assert.match(checkout, /isListingAvailableForWindow\(listing\.availability, windowStart, windowEnd, listing\.time_zone\)/);
  assert.match(availability, /isListingAvailableForWindow\(listing\.availability, start, end, listing\.time_zone\)/);
});
