import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const checkout = await readFile(new URL("../api/create-checkout-session.js", import.meta.url), "utf8");
const webhook = await readFile(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase-migration-007-booking-vehicles.sql", import.meta.url), "utf8");

test("booking review requires a saved vehicle selection", () => {
  assert.match(app, /Vehicle you are parking/);
  assert.match(app, /ps-booking-vehicle-options/);
  assert.match(app, /role="radiogroup"/);
  assert.match(app, /vehicleId: selectedVehicle\.id/);
  assert.match(app, /disabled=\{redirecting \|\| !selectedVehicle\}/);
});

test("checkout resolves the selected vehicle from authenticated profile metadata", () => {
  assert.match(checkout, /getBookableVehicles/);
  assert.match(checkout, /guest_vehicles: userMetadata\.guest_vehicles/);
  assert.match(checkout, /Select a complete vehicle from your Driver Profile/);
});

test("Stripe webhook snapshots the selected vehicle onto the booking", () => {
  for (const field of ["vehicle_profile_id", "vehicle_type", "vehicle_make", "vehicle_model", "vehicle_colour", "license_plate"]) {
    assert.match(webhook, new RegExp(`${field}:`));
  }
});

test("booking vehicle migration preserves existing rows and adds private snapshot columns", () => {
  assert.match(migration, /add column if not exists vehicle_profile_id text/i);
  assert.match(migration, /add column if not exists license_plate text/i);
  assert.match(migration, /vehicle_type in \('primary', 'guest'\)/i);
});
