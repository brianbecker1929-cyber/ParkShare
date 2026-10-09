import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  drivewayCarDataUrl,
  drivewayCarShapes,
  drivewayCarSvg,
  hasDrivewayVehicle,
} from "../src/lib/drivewayCar.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("vehicle-in-driveway image matches the booked vehicle colour", () => {
  const red = { vehicleMake: "BMW", vehicleModel: "X4", vehicleColour: "Red" };
  const yellow = { vehicleMake: "INFINITI", vehicleModel: "Q30", vehicleColour: "Yellow" };
  assert.equal(hasDrivewayVehicle(red), true);
  assert.equal(hasDrivewayVehicle({}), false);
  assert.match(drivewayCarShapes(red), /fill="#D93632"/);
  assert.match(drivewayCarShapes(yellow), /fill="#FFC107"/);
  assert.notEqual(drivewayCarSvg(red), drivewayCarSvg(yellow));
  assert.match(decodeURIComponent(drivewayCarDataUrl(red)), /<svg[^>]*viewBox="0 0 96 188"/);
});

test("front-end spot selection and the pre-Stripe vehicle switch use the same car roof", async () => {
  const app = await read("../src/App.jsx");
  assert.match(app, /function DrivewayCarVisual\(\{ vehicle \}\)/);
  assert.match(app, /function SpotPicker\(\{[^\n]*vehicle = null/);
  assert.match(app, /isChosen && hasDrivewayVehicle\(vehicle\)/);
  assert.match(app, /vehicle=\{selectedVehicle\}/);
  assert.match(app, /onClick=\{\(\) => \{ setSelectedVehicleId\(vehicle.id\); setSpotVehiclePickerOpen\(false\); \}\}/);
  assert.match(app, /vehicleId: selectedVehicle.id/);
  assert.match(app, /vehicle=\{selectedVehicle\}/);
});

test("both Driver and Host booking previews show the confirmed vehicle snapshot", async () => {
  const app = await read("../src/App.jsx");
  assert.match(app, /function BookedSpotDiagram\(\{[^\n]*vehicle \}\)/);
  assert.match(app, /<BookedSpotDiagram[^\n]*vehicle=\{vehicle\}/);
  assert.match(app, /<BookingParkingDetails listing=\{b.listingDetails\} spotLabel=\{b.spotLabel\} vehicle=\{b.vehicle\}/);
  assert.match(app, /<BookingParkingDetails listing=\{b.listing\} spotLabel=\{b.spotLabel\} vehicle=\{b.vehicle\}/);
  assert.match(app, /function ListingSatelliteView\(\{[^\n]*vehicle = null/);
  assert.match(app, /ps-satellite-booked-car/);
});

test("Stripe email uses the same parked car graphic and sends a separate host notification", async () => {
  const renderer = await read("../api/_driveway-image.js");
  const webhook = await read("../api/stripe-webhook.js");
  const email = await read("../api/_email.js");
  assert.match(renderer, /import \{ drivewayCarShapes, hasDrivewayVehicle \} from/);
  assert.match(renderer, /renderParkingSpotImage\(spotStates, chosenIndex, vehicle = null\)/);
  assert.match(renderer, /drivewayCarShapes\(vehicle \|\| \{\}\)/);
  assert.match(webhook, /renderParkingSpotImage\(spotStates, chosenIndex, booking\)/);
  assert.match(webhook, /hostEmail && hostEmail.toLowerCase\(\)/);
  assert.match(webhook, /hostBookingNotificationHtml/);
  assert.match(email, /export function hostBookingNotificationHtml/);
  assert.match(email, /Top-down vehicle in reserved Spot/);
  assert.match(webhook, /Promise.allSettled\(notifications\)/);
});

test("spot selection expands saved vehicle cards and blocks confirmation until selected", async () => {
  const app = await read("../src/App.jsx");
  assert.match(app, /const chooseSpot = \(index\) => \{\s*setChosenSpot\(index\);\s*setSpotVehiclePickerOpen\(true\);/);
  assert.match(app, /<section className="ps-spot-vehicle-panel" ref=\{spotVehiclePickerRef\}/);
  assert.match(app, /Select your vehicle to preview it in the driveway/);
  assert.match(app, /role="radiogroup" aria-label="Select your parking vehicle"/);
  assert.match(app, /getBookableVehicles\(user \|\| \{\}\)/);
  assert.match(app, /disabled=\{chosenSpot === null \|\| !selectedVehicle \|\| selectedAvailability\?\.available === false\}/);
  assert.match(app, /!selectedVehicle \? "Select a vehicle to continue"/);
});

test("the selected car carries from spot confirmation to checkout and remains switchable", async () => {
  const app = await read("../src/App.jsx");
  assert.match(app, /selectedVehicleId=\{selectedVehicleId\}/);
  assert.match(app, /onVehicleChange=\{setSelectedVehicleId\}/);
  assert.match(app, /function PaymentModal\(\{[^\n]*selectedVehicleId, onVehicleChange \}\)/);
  assert.match(app, /onClick=\{\(\) => \{ onVehicleChange\(vehicle.id\); setChangeVehicleOpen\(false\); \}\}/);
  assert.match(app, /<SpotPicker[^\n]*vehicle=\{selectedVehicle\}/);
  assert.match(app, /vehicleId: selectedVehicle.id/);
});


test("host upcoming booking displays the same saved vehicle in its badge and parking diagram", async () => {
  const app = await read("../src/App.jsx");
  const hostStart = app.indexOf("function HostDashboard(");
  const hostEnd = app.indexOf("function DrivewayFrame(", hostStart);
  assert.ok(hostStart >= 0 && hostEnd > hostStart);
  const host = app.slice(hostStart, hostEnd);
  // Match the record returned from bookings to the badge and map, including
  // vehicles purchased before the new preview was deployed.
  for (const [camel, snake] of [
    ["vehicleMake", "vehicle_make"],
    ["vehicleModel", "vehicle_model"],
    ["vehicleColour", "vehicle_colour"],
    ["licensePlate", "license_plate"],
  ]) {
    assert.ok(host.includes(`${camel}: row.${snake} || ""`), `Missing host snapshot ${snake}`);
  }
  assert.match(host, /<BookingVehicleVisual vehicle=\{b\.vehicle\} \/>/);
  assert.match(host, /<BookingParkingDetails listing=\{b\.listingDetails\} spotLabel=\{b\.spotLabel\} vehicle=\{b\.vehicle\} \/>/);

  const storedYellow = {
    vehicle_make: "INFINITI",
    vehicle_model: "Q30",
    vehicle_colour: "Yellow",
    license_plate: "ABCD 123",
  };
  assert.equal(hasDrivewayVehicle(storedYellow), true);
  assert.match(drivewayCarSvg(storedYellow), /fill="#FFC107"/);
});

test("confirmed-space diagram never misidentifies a vehicle as generic red", async () => {
  const app = await read("../src/App.jsx");
  const from = app.indexOf("function BookedSpotDiagram(");
  const to = app.indexOf("function BookingParkingDetails(", from);
  const diagram = app.slice(from, to);
  assert.ok(from >= 0 && to > from);
  assert.match(diagram, /<DrivewayCarVisual vehicle=\{vehicle\} \/>/);
  assert.match(diagram, /src=\{drivewayCarDataUrl\(\{\}\)\}/);
  assert.match(diagram, /Neutral car illustration; booked vehicle details unavailable/);
  assert.doesNotMatch(diagram, /src="\/car-icon\.png"/);
});
