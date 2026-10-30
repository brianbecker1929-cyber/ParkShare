import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { formatBookNowTimes } from "../src/lib/bookNowTimes.js";

test("Book Now uses the listing zone regardless of the browser zone", () => {
  const script = `import {formatBookNowTimes} from './src/lib/bookNowTimes.js';
    process.stdout.write(JSON.stringify(formatBookNowTimes('America/Toronto', 1, '2026-10-30T16:15:00Z')));`;
  const expected = formatBookNowTimes("America/Toronto", 1, "2026-10-30T16:15:00Z");
  for (const TZ of ["America/Vancouver", "Europe/Athens", "Pacific/Auckland", "UTC"]) {
    const actual = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: new URL("..", import.meta.url), encoding: "utf8", env: { PATH: process.env.PATH, TZ },
    }));
    assert.deepEqual(actual, expected, TZ);
  }
  assert.match(expected.start, /12:15/);
  assert.match(expected.end, /1:15/);
  assert.match(expected.start, /EDT.*America\/Toronto/);
  assert.match(expected.end, /EDT.*America\/Toronto/);
});

test("different property zones change both displayed times", () => {
  const result = formatBookNowTimes("America/Vancouver", 1.25, "2026-10-30T16:15:00Z");
  assert.match(result.start, /9:15.*PDT.*America\/Vancouver/);
  assert.match(result.end, /10:30.*PDT.*America\/Vancouver/);
});

test("overnight departure displays its actual property-local date", () => {
  const result = formatBookNowTimes("America/Toronto", 2, "2026-10-31T03:30:00Z");
  assert.match(result.start, /Oct 30, 2026.*11:30/);
  assert.match(result.end, /Oct 31, 2026.*1:30/);
  assert.doesNotMatch(result.end, /today/);
});

test("DST transitions preserve elapsed duration and label each instant's offset", () => {
  const fall = formatBookNowTimes("America/Toronto", 1, "2026-11-01T05:30:00Z");
  assert.match(fall.start, /1:30.*EDT/);
  assert.match(fall.end, /1:30.*EST/);
  const spring = formatBookNowTimes("America/Toronto", 1, "2026-03-08T06:30:00Z");
  assert.match(spring.start, /1:30.*EST/);
  assert.match(spring.end, /3:30.*EDT/);
});

test("unverified time zones and invalid windows cannot fall back to browser time", () => {
  for (const zone of [undefined, null, "", " ", "Bad/Zone"]) {
    assert.equal(formatBookNowTimes(zone, 1, "2026-10-30T16:15:00Z"), null);
  }
  for (const hours of [0, -1, NaN, Infinity, "bad"]) {
    assert.equal(formatBookNowTimes("America/Toronto", hours), null);
  }
  assert.equal(formatBookNowTimes("America/Toronto", 1, "bad"), null);
});

test("the booking panel wires both labels to the property-zone preview", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const panel = app.slice(app.indexOf("function ListingDetail("), app.indexOf("function useAllListings("));
  assert.match(panel, /formatBookNowTimes\(listing\.timeZone, hours\)/);
  assert.match(panel, /bookNowTimes\?\.start/);
  assert.match(panel, /Ends around \$\{bookNowTimes\.end\}/);
  assert.doesNotMatch(panel, /toLocaleTimeString\(undefined/);
});
