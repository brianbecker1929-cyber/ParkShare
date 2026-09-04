import test from "node:test";
import assert from "node:assert/strict";
import {
  formatVehicleVisualSummary,
  getVehicleAssetPath,
  getVehicleBodyType,
  getVehicleColourHex,
  getVehicleColourName,
} from "../src/lib/vehicleVisuals.js";

test("maps familiar models to a matching generic body style", () => {
  assert.equal(getVehicleBodyType({ vehicleMake: "Toyota", vehicleModel: "RAV4" }), "suv");
  assert.equal(getVehicleBodyType({ vehicleMake: "Ford", vehicleModel: "F-150" }), "pickup");
  assert.equal(getVehicleBodyType({ vehicleMake: "Honda", vehicleModel: "Civic" }), "sedan");
  assert.equal(getVehicleBodyType({ vehicleMake: "Honda", vehicleModel: "Odyssey" }), "van");
  assert.equal(getVehicleBodyType({ vehicleMake: "Volkswagen", vehicleModel: "Golf" }), "hatchback");
  assert.equal(getVehicleBodyType({ vehicleMake: "Mazda", vehicleModel: "CX-5" }), "suv");
  assert.equal(getVehicleBodyType({ vehicleMake: "Polestar", vehicleModel: "3" }), "suv");
  assert.equal(getVehicleBodyType({ vehicleMake: "Toyota", vehicleModel: "GR86" }), "coupe");
});

test("uses the selected colour and a safe neutral fallback", () => {
  assert.equal(getVehicleColourHex({ vehicleColour: "Red" }), "#D93632");
  assert.equal(getVehicleColourHex({ vehicleColour: "Silver" }), "#BFC5CA");
  assert.equal(getVehicleColourHex({ vehicleColour: "Unlisted finish" }), "#87939C");
  assert.equal(getVehicleColourName({ vehicleColour: "Blue" }), "Blue");
  assert.equal(getVehicleColourName({ vehicleColour: "Unlisted finish" }), "Other");
});

test("resolves optimized artwork from the mapped body style", () => {
  assert.equal(getVehicleAssetPath({ vehicleModel: "RAV4" }), "/vehicles/vehicle-suv.webp");
  assert.equal(getVehicleAssetPath({ vehicleModel: "Accord" }), "/vehicles/vehicle-sedan.webp");
});

test("formats the compact visual summary without repeating the plate", () => {
  assert.equal(
    formatVehicleVisualSummary({ vehicleMake: "Toyota", vehicleModel: "RAV4", vehicleColour: "Red", licensePlate: "ABC 123" }),
    "Toyota RAV4 · Red",
  );
});
