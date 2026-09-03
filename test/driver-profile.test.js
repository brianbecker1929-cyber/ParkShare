import test from "node:test";
import assert from "node:assert/strict";
import {
  getDriverProfileCompletion,
  normaliseDriverProfile,
  validateDriverProfile,
} from "../src/lib/driverProfile.js";

test("normalises Driver profile fields", () => {
  assert.deepEqual(
    normaliseDriverProfile({ name: "  Test Driver  ", phone: " 416-555-0100 ", vehicle_details: " Blue sedan " }),
    { name: "Test Driver", phone: "416-555-0100", vehicleDetails: "Blue sedan" },
  );
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
    vehicleDetails: "Blue Honda Civic",
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
});
