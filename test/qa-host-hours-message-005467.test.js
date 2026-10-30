import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { listingAvailabilityMessage, canChooseListingSpot } from "../src/lib/spotAvailability.js";

test("closed Host hours explain the schedule rather than claiming occupancy", () => {
  const closed = { available: false, hostScheduleOpen: false, reason: "host_schedule", spacesFree: 0, spacesTotal: 2, spotStatus: { A: false, B: false } };
  for (const mode of ["now", "advance"]) {
    const text = listingAvailabilityMessage(closed, mode);
    assert.match(text, /Outside the Host's available hours/);
    assert.doesNotMatch(text, /taken|booked|full/i);
    assert.equal(canChooseListingSpot({ isRealListing: true, hostRentable: true, availableData: closed, label: "A" }), false);
  }
});

test("either API schedule signal takes precedence over capacity counts", () => {
  for (const data of [{ reason: "host_schedule" }, { hostScheduleOpen: false },
    { available: true, hostScheduleOpen: false, spacesFree: 2, spacesTotal: 2 }]) {
    assert.match(listingAvailabilityMessage(data, "now"), /Outside the Host's available hours/);
  }
});

test("genuinely occupied open hours retain the full-capacity message", () => {
  const full = { available: false, hostScheduleOpen: true, spacesFree: 0, spacesTotal: 2 };
  assert.match(listingAvailabilityMessage(full, "now"), /All spots are taken for right now/);
  assert.match(listingAvailabilityMessage(full, "advance"), /All spots are taken for that time/);
});

test("an open free bay remains bookable and the free count is shown", () => {
  const open = { available: true, hostScheduleOpen: true, spacesFree: 1, spacesTotal: 2, spotStatus: { A: true, B: false } };
  assert.match(listingAvailabilityMessage(open, "now"), /1 of 2 spots free/);
  assert.equal(canChooseListingSpot({ isRealListing: true, hostRentable: true, availableData: open, label: "A" }), true);
  assert.equal(canChooseListingSpot({ isRealListing: true, hostRentable: true, availableData: open, label: "B" }), false);
});

test("an unknown availability result does not claim spots are taken", () => {
  for (const data of [null, {}, { available: false }]) {
    assert.doesNotMatch(listingAvailabilityMessage(data, "now"), /taken|booked|full/i);
  }
});

test("booking warning and spot picker share the schedule-aware message", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const panel = app.slice(app.indexOf("function ListingDetail("), app.indexOf("function useAllListings("));
  assert.equal((panel.match(/listingAvailabilityMessage\(selectedAvailability, bookingMode\)/g) || []).length, 2);
  assert.doesNotMatch(panel, /All spots are taken|Full for that/);
});
