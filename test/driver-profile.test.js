import test from "node:test";
import assert from "node:assert/strict";
import {
  formatVehicleDetails,
  getBookableVehicles,
  getDriverProfileCompletion,
  normaliseDriverProfile,
  parseLegacyVehicleDetails,
  validateDriverProfile,
} from "../src/lib/driverProfile.js";

test("normalises Driver profile fields", () => {
  assert.deepEqual(
    normaliseDriverProfile({ name: "  Test Driver  ", phone: " 416-555-0100 ", vehicle_details: " Blue sedan " }),
    {
      name: "Test Driver",
      phone: "416-555-0100",
      vehicleMake: "",
      vehicleModel: "",
      vehicleColour: "",
      licensePlate: "",
      guestVehicles: [],
      vehicleDetails: "Blue sedan",
    },
  );
});

test("migrates a recognised legacy vehicle description into dropdown values", () => {
  assert.deepEqual(parseLegacyVehicleDetails("Blue Honda Accord"), {
    vehicleMake: "Honda",
    vehicleModel: "Accord",
    vehicleColour: "Blue",
  });
  assert.equal(formatVehicleDetails({ vehicleColour: "Blue", vehicleMake: "Honda", vehicleModel: "Accord" }), "Blue Honda Accord");
});

test("reports a newly registered Driver as one-third complete", () => {
  const result = getDriverProfileCompletion({ name: "Test Driver" });
  assert.equal(result.completed, 1);
  assert.equal(result.total, 3);
  assert.equal(result.percentage, 33);
  assert.equal(result.complete, false);
});

test("marks a Driver complete after phone and vehicle details are supplied", () => {
  const result = getDriverProfileCompletion({
    name: "Test Driver",
    phone: "416-555-0100",
    vehicleMake: "Honda",
    vehicleModel: "Civic",
    vehicleColour: "Blue",
    licensePlate: "ABCD 123",
  });
  assert.equal(result.completed, 3);
  assert.equal(result.percentage, 100);
  assert.equal(result.complete, true);
});

test("validates name and an entered phone number", () => {
  const missingName = validateDriverProfile({ name: "", phone: "" });
  assert.equal(missingName.valid, false);
  assert.equal(missingName.errors.name, "Enter your full name.");

  const shortPhone = validateDriverProfile({ name: "Test Driver", phone: "555" });
  assert.equal(shortPhone.valid, false);
  assert.match(shortPhone.errors.phone, /complete phone number/i);

  const optionalDetails = validateDriverProfile({ name: "Test Driver", phone: "", vehicleDetails: "" });
  assert.equal(optionalDetails.valid, true);

  const incompleteVehicle = validateDriverProfile({ name: "Test Driver", vehicleMake: "Honda" });
  assert.equal(incompleteVehicle.valid, false);
  assert.match(incompleteVehicle.errors.vehicleModel, /select/i);
  assert.match(incompleteVehicle.errors.vehicleColour, /select/i);

  const completeVehicle = validateDriverProfile({
    name: "Test Driver",
    vehicleMake: "Honda",
    vehicleModel: "Accord",
    vehicleColour: "Blue",
    licensePlate: "abcd 123",
  });
  assert.equal(completeVehicle.valid, true);
  assert.equal(completeVehicle.normalised.licensePlate, "ABCD 123");

  const invalidPlate = validateDriverProfile({
    name: "Test Driver",
    vehicleMake: "Honda",
    vehicleModel: "Accord",
    vehicleColour: "Blue",
    licensePlate: "ABC@123",
  });
  assert.equal(invalidPlate.valid, false);
  assert.match(invalidPlate.errors.licensePlate, /valid license plate/i);
});

test("normalises and validates saved guest vehicles", () => {
  const result = validateDriverProfile({
    name: "Test Driver",
    guestVehicles: [{
      id: "friends-car",
      vehicleMake: "Toyota",
      vehicleModel: "RAV4",
      vehicleColour: "Red",
      licensePlate: "guest 12",
    }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.normalised.guestVehicles[0].licensePlate, "GUEST 12");

  const incomplete = validateDriverProfile({
    name: "Test Driver",
    guestVehicles: [{ id: "guest-1", vehicleMake: "Honda" }],
  });
  assert.equal(incomplete.valid, false);
  assert.match(incomplete.errors["guestVehicles.0.vehicleModel"], /select/i);
  assert.match(incomplete.errors["guestVehicles.0.licensePlate"], /valid/i);
});

test("offers complete Primary and Guest vehicles for booking", () => {
  const vehicles = getBookableVehicles({
    vehicleMake: "Honda",
    vehicleModel: "Civic",
    vehicleColour: "Blue",
    licensePlate: "MAIN 1",
    guestVehicles: [
      { id: "guest-ready", vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleColour: "Red", licensePlate: "GUEST 2" },
      { id: "guest-incomplete", vehicleMake: "Ford", vehicleModel: "Escape" },
    ],
  });

  assert.deepEqual(vehicles.map(vehicle => vehicle.id), ["primary", "guest-ready"]);
  assert.equal(vehicles[0].label, "Primary vehicle");
  assert.equal(vehicles[1].label, "Guest vehicle 1");
});
