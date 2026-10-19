import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateCanadianPostalCode, CANADIAN_POSTAL_HELP } from "../src/lib/canadianPostalCode.js";

test("BUG-005136: accepts Canadian urban and rural codes, including lowercase and no space", () => {
  for (const [input, expected] of [
    ["L4J 1A1", "L4J 1A1"],
    ["l4j1a1", "L4J 1A1"],
    ["  k1a0b1 ", "K1A 0B1"],
    ["M5V 2T6", "M5V 2T6"],
    ["H0H0H0", "H0H 0H0"],
    ["X0A 0H0", "X0A 0H0"],
    ["Y1A 2B3", "Y1A 2B3"],
    ["V6B 3K9", "V6B 3K9"],
    ["A0A 0A0", "A0A 0A0"],
  ]) {
    assert.deepEqual(validateCanadianPostalCode(input),
      { valid: true, normalized: expected, error: null }, input);
  }
});

test("rejects US ZIPs, empty fields, letters prohibited by Canada Post and malformed formats", () => {
  for (const input of [
    "", " ", "12345", "ABCDE", "ZZZ 999", "W1A 1A1", "Z1A 1A1",
    "D1A 1A1", "F1A 1A1", "I1A 1A1", "O1A 1A1", "Q1A 1A1", "U1A 1A1",
    "L4D 1A1", "L4F 1A1", "L4I 1A1", "L4O 1A1", "L4Q 1A1", "L4U 1A1",
    "L4J 1D1", "L4J 1F1", "L4J 1I1", "L4J 1O1", "L4J 1Q1", "L4J 1U1",
    "L4J-1A1", "L4J  1A1", "L4J\t1A1", "L4J 1A1X", "L4J1A",
    "L4J 1AA", "AAAAAA", "M5V 2T6, Toronto",
  ]) {
    assert.deepEqual(validateCanadianPostalCode(input),
      { valid: false, normalized: null, error: CANADIAN_POSTAL_HELP }, JSON.stringify(input));
  }
  for (const bad of [null, undefined, 123456, {}, []]) {
    assert.equal(validateCanadianPostalCode(bad).valid, false);
  }
});

test("Host step 1 and final publication reject invalid postal codes before any photo uploads", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /import \{ validateCanadianPostalCode \} from "\.\/lib\/canadianPostalCode"/);
  assert.match(app, /const postalCheck = validateCanadianPostalCode\(form\.postal\)/);
  assert.match(app, /postalCheck\.normalized \|\| form\.postal\.trim\(\)/);
  assert.match(app, /!postalCheck\.valid && \{ label: "Enter a valid Canadian postal code/);
  assert.match(app, /disabled=\{!form\.street\.trim\(\) \|\| !form\.city\.trim\(\) \|\| !form\.region\.trim\(\) \|\| !postalCheck\.valid \|\| !hasListingCoordinates\(form\) \|\| !propertyTimeZone\}/);
  assert.match(app, /if \(!form\.street\.trim\(\) \|\| !form\.city\.trim\(\) \|\| !form\.region\.trim\(\) \|\| !postalCheck\.valid\)/);
  const publish = app.slice(app.indexOf("const publish = async () =>"), app.indexOf("const resetAll =", app.indexOf("const publish = async () =>")));
  assert.ok(publish.indexOf("!postalCheck.valid") < publish.indexOf("uploadListingPhotos("),
    "final check must run before storage upload and listing insertion");
  assert.match(app, /role=\{form\.postal\.trim\(\) && !postalCheck\.valid \? "alert" : undefined\}/);
  assert.match(app, /autoComplete="postal-code"/);
  assert.match(app, /onBlur=\{\(\) => \{ if \(postalCheck\.valid/);
  assert.match(app, /Address details entered \(not independently verified\)/);
  assert.doesNotMatch(app, /Address confirmed: /);
});

test("choosing an address suggestion retains its postal code but does not bypass format checks", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /const code = validateCanadianPostalCode\(s\.postal\)/);
  assert.match(app, /postal: code\.normalized \|\| String\(s\.postal \|\| ""\)/);
  assert.match(app, /postalCheck\.valid && suggestions\.length === 0/);
});
