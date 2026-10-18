import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { calculateBookingAmounts } from "../api/_booking-rules.js";

test("BUG-005147: two-hour booking at $12 uses exactly $27.60, not $28.00", () => {
  const result = calculateBookingAmounts(12, 2, 0.15);
  assert.equal(result.hourlyCents, 1200);
  assert.equal(result.subtotalCents, 2400);
  assert.equal(result.serviceFeeCents, 360);
  assert.equal(result.totalCents, 2760);
});

test("scheduled fractional hours and cent-level rates match server checkout", () => {
  const booking = calculateBookingAmounts(12.35, 2.25, 0.15);
  assert.equal(booking.subtotalCents, Math.round(1235 * 2.25));
  assert.equal(booking.totalCents, booking.subtotalCents + booking.serviceFeeCents);
});

test("Driver pricing preview and review modal both use server integer cents", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /import \{ calculateBookingAmounts \} from "\.\.\/api\/_booking-rules\.js";/);
  assert.match(app, /const \{ subtotalCents, serviceFeeCents, totalCents \} = calculateBookingAmounts\(listing\.price, hours\)/);
  assert.match(app, /\{money\(calculateBookingAmounts\(listing\.price, hours\)\.totalCents \/ 100\)\}/);
  assert.doesNotMatch(app, /money\(Math\.round\(listing\.price \* hours \* 1\.15\)\)/);
});
