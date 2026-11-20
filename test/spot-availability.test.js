import test from "node:test";
import assert from "node:assert/strict";
import { canChooseListingSpot, availabilityRequestKey } from "../src/lib/spotAvailability.js";

const opts = { isRealListing: true, hostRentable: true, label: "A" };

test("real listing bays stay disabled while availability is pending or fails", () => {
  assert.equal(canChooseListingSpot({ ...opts, availableData:null }), false);
  assert.equal(canChooseListingSpot({ ...opts, availableData:{available:true} }), false);
  assert.equal(canChooseListingSpot({ ...opts, availableData:{available:false,spotStatus:{A:true}} }), false);
});
test("only the specifically confirmed free bay can be selected", () => {
  const status={available:true,spacesFree:1,spotStatus:{A:false,B:true}};
  assert.equal(canChooseListingSpot({ ...opts, availableData:status }), false);
  assert.equal(canChooseListingSpot({ ...opts, label:"B", availableData:status }), true);
  assert.equal(canChooseListingSpot({ ...opts, label:"B", hostRentable:false, availableData:status }), false);
});
test("demo listings preserve the historical interactive spot preview", () => {
  assert.equal(canChooseListingSpot({ isRealListing:false,hostRentable:true,label:"A",availableData:null }), true);
  assert.equal(canChooseListingSpot({ isRealListing:false,hostRentable:false,label:"B",availableData:null }), false);
});
test("each selection window has a distinct result key to reject stale responses", () => {
  const first=availabilityRequestKey({listingId:14,mode:"advance",hours:2,bookingDate:"2026-10-16",startHour:9});
  const later=availabilityRequestKey({listingId:14,mode:"advance",hours:2,bookingDate:"2026-10-16",startHour:12});
  assert.notEqual(first,later);
  assert.notEqual(first,availabilityRequestKey({listingId:14,mode:"now",hours:2}));
});
