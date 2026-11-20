import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canChooseListingSpot } from "../src/lib/spotAvailability.js";

const getApp = () => readFile(new URL("../src/App.jsx", import.meta.url), "utf8");

test("held or already-booked bays cannot be chosen even if another bay is free", () => {
  const result = { available: true, hostScheduleOpen: true, spacesFree: 1, spotStatus: { A: false, B: true, C: false } };
  const choice = label => canChooseListingSpot({
    isRealListing: true, hostRentable: true, availableData: result, label,
  });
  assert.equal(choice("A"), false);
  assert.equal(choice("B"), true);
  assert.equal(choice("C"), false);
  assert.equal(canChooseListingSpot({isRealListing:true,hostRentable:true,availableData:null,label:"B"}), false);
});

test("satellite rectangles use exact per-bay availability for styling and clicking", async () => {
  const app = await getApp();
  const satellite = app.slice(app.indexOf("function ListingSatelliteView("), app.indexOf("function MiniCalendar("));
  assert.match(satellite, /availableData = null, isRealListing = false/);
  assert.match(satellite, /const canPick = isRent && canChooseListingSpot\(/);
  assert.match(satellite, /availableData,/);
  assert.match(satellite, /label: String.fromCharCode\(65 \+ myLabel\)/);
  assert.match(satellite, /clickable: interactive && canPick/);
  assert.match(satellite, /onClick=\{canPick && interactive/);
  assert.match(satellite, /isRent && canPick \? SPOT_STROKE_RENT : SPOT_STROKE_PRIVATE/);
});

test("real satellite picker and payment preview both receive the same window-specific result", async () => {
  const app = await getApp();
  const detail = app.slice(app.indexOf("function ListingDetail("), app.indexOf("function useAllListings("));
  const payment = app.slice(app.indexOf("function PaymentModal("), app.indexOf("function ListingSatelliteView("));
  assert.match(detail, /<ListingSatelliteView[^>]+availableData=\{selectedAvailability\} isRealListing=\{numericIdForAvailability !== null\}/);
  assert.match(detail, /<PaymentModal[\s\S]*?availableData=\{selectedAvailability\}/);
  assert.match(payment, /function PaymentModal\([^\n]+availableData = null/);
  assert.match(payment, /<SpotPicker[^\n]+availableData=\{availableData\} isRealListing=\{isRealListing\}/);
});
