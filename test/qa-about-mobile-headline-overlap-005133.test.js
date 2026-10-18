import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssUrl = new URL("../src/index.css", import.meta.url);
const appUrl = new URL("../src/App.jsx", import.meta.url);

test("BUG-005133: mobile heading row is structurally separate from mascot row in BOTH About cards", async () => {
  const css = await readFile(cssUrl, "utf8");
  const marker = "BetterQA BUG-005133 — mobile About Us audience headings / mascot clearance";
  const start = css.lastIndexOf(marker);
  assert.ok(start > 0, "a scoped final mobile fix must be last");
  const fix = css.slice(start);
  assert.match(fix, /@media \(max-width: 819px\)/);
  assert.match(fix, /ps-about-audience-card\.ps-about-host-card/);
  assert.match(fix, /ps-about-audience-card\.ps-about-driver-card/);
  assert.match(fix, /ps-about-host-card > div,[\s\S]*ps-about-driver-card > div \{\s*display: contents !important/);
  assert.match(fix, /ps-about-host-card h3,[\s\S]*ps-about-driver-card h3 \{[\s\S]*grid-row: 2 !important/);
  assert.match(fix, /ps-about-host-card \.ps-about-card-parker,[\s\S]*ps-about-driver-card \.ps-about-card-parker \{[\s\S]*grid-row: 3 \/ span 2 !important/);
  assert.match(fix, /grid-row: 3 \/ span 2 !important;[\s\S]*transform: none !important;/);
  assert.match(fix, /ps-about-host-card > button,[\s\S]*ps-about-driver-card > button \{[\s\S]*grid-row: 5 !important/);
  assert.match(fix, /max-width: 360px/);
});

test("BUG-005133: supporting copy lives beside the mascot and never in the title's row", async () => {
  const css = await readFile(cssUrl, "utf8");
  const fix = css.slice(css.lastIndexOf("BetterQA BUG-005133 — mobile About Us audience headings / mascot clearance"));
  assert.match(fix, /p:first-of-type \{[\s\S]*grid-column: 2 !important;[\s\S]*grid-row: 3 !important/);
  assert.match(fix, /p:last-of-type \{[\s\S]*grid-column: 2 !important;[\s\S]*grid-row: 4 !important/);
  assert.match(fix, /max-width: 100% !important/);
  assert.match(fix, /max-height: 230px !important/);
  assert.match(fix, /overflow-wrap: anywhere/);
  assert.doesNotMatch(fix, /@media \(min-width: 820px\)/, "desktop layout stays unchanged");
});

test("BUG-005133: William, Parker, headings and CTA remain unchanged in JSX", async () => {
  const app = await readFile(appUrl, "utf8");
  const region = app.slice(app.indexOf('<section id="marketplace"'), app.indexOf('<section id="parker"'));
  assert.match(region, /ps-about-host-card/);
  assert.match(region, /ParkShare_William_02_Thumbs_Up-768\.webp/);
  assert.match(region, /Your empty space has potential\./);
  assert.match(region, /Explore Hosting →/);
  assert.match(region, /ps-about-driver-card/);
  assert.match(region, /ParkShare_Parker_16_Reading_A_Map-768\.webp/);
  assert.match(region, /Know where you&apos;re going to park\./);
  assert.match(region, /Find Parking →/);
  assert.match(region, /className="ps-about-card-parker"/);
});
