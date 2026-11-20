import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateHourlyRate, NEW_LISTING_MAX_HOURLY_RATE_CAD } from "../src/lib/listingPrice.js";

test("accepts valid whole-dollar and cent-level CAD hourly rates", () => {
  for (const [raw, expected] of [
    ["1", 1], ["1.00", 1], ["12.50", 12.5], ["99.99", 99.99],
    ["200", 200], [1, 1], [12.75, 12.75],
  ]) {
    const result = validateHourlyRate(raw, { maxRate: NEW_LISTING_MAX_HOURLY_RATE_CAD });
    assert.equal(result.valid, true, String(raw));
    assert.equal(result.value, expected);
  }
});

test("rejects zero, negative, blank, nonnumeric, exponent and sub-cent rates", () => {
  for (const raw of [
    "", " ", "0", "0.00", "0.99", "-1", "-12.50", "1.001",
    "12.345", "1e2", "Infinity", "NaN", "$12", "1,000", "1.2.3",
    null, undefined, NaN, Infinity, -Infinity, -3,
  ]) {
    const result = validateHourlyRate(raw);
    assert.equal(result.valid, false, String(raw));
    assert.match(result.error, /valid hourly rate/i);
  }
});

test("new Host listings honor displayed $200 ceiling but legacy edits retain valid historical prices", () => {
  assert.equal(validateHourlyRate("200.01", { maxRate: 200 }).valid, false);
  assert.equal(validateHourlyRate("900", { maxRate: 200 }).valid, false);
  assert.deepEqual(validateHourlyRate("900"), { valid: true, value: 900, error: null });
  assert.equal(validateHourlyRate("900.001").valid, false);
});

test("Host creation, edit and checkout refuse invalid price before any write/payment", async () => {
  const [app, checkout, sql] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../api/create-checkout-session.js", import.meta.url), "utf8"),
    readFile(new URL("../docs/sql-proposals/bug-005137-hourly-price-constraint.sql", import.meta.url), "utf8"),
  ]);
  assert.match(app, /const rate = validateHourlyRate\(price\)/);
  assert.match(app, /const rate = validateHourlyRate\(updated.price\)/);
  assert.match(app, /const rate = validateHourlyRate\(form.price, \{ maxRate: NEW_LISTING_MAX_HOURLY_RATE_CAD \}\)/);
  assert.match(app, /price: rate.value/);
  assert.doesNotMatch(app, /price: Number\(form.price\) \|\| 12/);
  assert.doesNotMatch(app, /price: Number\(updated.price\) \|\| 1/);
  assert.match(app, /aria-invalid=\{Boolean\(form.price && !validateHourlyRate/);
  assert.match(app, /role="alert"/);
  assert.match(app, /disabled=\{!validateHourlyRate\(form.price, \{ maxRate: NEW_LISTING_MAX_HOURLY_RATE_CAD \}\).valid\}/);

  assert.match(checkout, /const rate = validateHourlyRate\(listing.price\)/);
  assert.match(checkout, /if \(!rate.valid\) return res.status\(409\)/);
  const rejectAt = checkout.indexOf("if (!rate.valid) return res.status(409)");
  assert.ok(rejectAt < checkout.indexOf('supabaseAdmin.rpc("create_booking_hold"'));
  assert.ok(rejectAt < checkout.indexOf("stripe.checkout.sessions.create("));
  assert.match(checkout, /Number.isSafeInteger/);
  assert.match(sql, /check \(price >= 1 and price = round\(price, 2\)\)/);
  assert.match(sql, /not valid;/);
  assert.doesNotMatch(sql, /price <= 200/i);
  assert.doesNotMatch(sql, /update\s+public.listings/i);
});
