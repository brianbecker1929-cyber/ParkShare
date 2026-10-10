import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { DEMO_VEHICLES } from "../api/preview-premium-vehicles.js";
import { renderParkingSpotImage } from "../api/_driveway-image.js";

const read = file => readFile(new URL(file, import.meta.url), "utf8");

function cssRule(styles, selector) {
  const index = styles.indexOf(selector + " {");
  assert.ok(index >= 0, "Missing CSS selector " + selector);
  const start = styles.indexOf("{", index);
  return styles.slice(start + 1, styles.indexOf("}", start));
}
function cssPercent(rule, property) {
  const match = rule.match(new RegExp("\\b" + property + "\\s*:\\s*(\\d+)%"));
  assert.ok(match, "Missing CSS property " + property);
  return Number(match[1]);
}

test("all approved WebP cars use the bold reference scale with no desktop pixel caps", async () => {
  const css = await read("../src/index.css");
  const picker = cssRule(css, ".ps-driveway-car-roof");
  const booked = cssRule(css, ".ps-booked-spot > img.ps-driveway-car-roof");
  const compact = cssRule(css, ".ps-booking-parking-details.is-compact .ps-booked-spot > img.ps-driveway-car-roof");

  for (const rule of [picker, booked, compact]) {
    assert.equal(cssPercent(rule, "width"), 96, "Keep image close to bay width with a small margin");
    assert.match(rule, /max-width:\s*none;/, "No tiny icon-size ceiling");
    assert.ok(cssPercent(rule, "height") >= 78, "Use almost 80% of bay height");
    assert.ok(cssPercent(rule, "max-height") <= 82, "Leave dedicated text zones");
  }
  assert.match(picker, /object-fit:\s*contain;/, "Never distort high-detail artwork");
});

test("email car uses the full selected bay beneath its protected spot label", async () => {
  const email = await read("../api/_driveway-image.js");
  assert.match(email, /booked\.w \* \.96/);
  assert.match(email, /booked\.h \* \.83/);
  assert.match(email, /booked\.h \* \.13/);
  assert.doesNotMatch(email, /pixelLabel\("RESERVED"/);
  assert.match(email, /premiumVehicleBuffer\(vehicle\)/);
  assert.match(email, /fit:\s*"contain"/, "Preserve artwork proportions");
});

test("all six reservation bodies render with the same large approved bay scale in email PNG", async () => {
  for (const vehicle of DEMO_VEHICLES) {
    const png = await renderParkingSpotImage([false, true, false, false], 1, vehicle);
    const info = await sharp(png).metadata();
    assert.equal(info.format, "png");
    assert.equal(info.width, 1000);
    assert.ok(png.length > 11000);
  }
});
