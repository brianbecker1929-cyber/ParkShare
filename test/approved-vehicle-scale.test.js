import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file) => readFile(new URL(file, import.meta.url), "utf8");

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
function enlarged(before, after, name) {
  assert.ok(after > before, name + " must grow");
  const factor = after / before;
  assert.ok(factor >= 1.10 && factor <= 1.15,
    name + " expected 10–15% size increase, got " + ((factor - 1) * 100).toFixed(1) + "%");
}
test("premium selected car stays 10–15% larger across all responsive website spots", async () => {
  const css = await read("../src/index.css");
  const picker = cssRule(css, ".ps-driveway-car-roof");
  const reserved = cssRule(css, ".ps-booked-spot > img.ps-driveway-car-roof");
  const compact = cssRule(css, ".ps-booking-parking-details.is-compact .ps-booked-spot > img.ps-driveway-car-roof");

  enlarged(83, cssPercent(picker, "width"), "Picker width");
  enlarged(66, cssPercent(picker, "height"), "Picker height");
  enlarged(82, cssPercent(reserved, "width"), "Booking width");
  enlarged(67, cssPercent(reserved, "height"), "Booking height");
  enlarged(80, cssPercent(compact, "width"), "Compact width");
  enlarged(64, cssPercent(compact, "height"), "Compact height");
  assert.match(picker, /object-fit:\s*contain/);
  assert.ok(cssPercent(reserved, "width") < 100);
  assert.ok(cssPercent(reserved, "max-height") <= 80);
});

test("email approved image expands ~12% while Spot and RESERVED labels remain clear", async () => {
  const email = await read("../api/_driveway-image.js");
  const width = Number(email.match(/const carWidth\s*=\s*Math.max\(1,\s*Math.round\(booked.w\s*\*\s*(\.\d+)\)/)?.[1]);
  const height = Number(email.match(/const carHeight\s*=\s*Math.max\(1,\s*Math.round\(booked.h\s*\*\s*(\.\d+)\)/)?.[1]);
  const top = Number(email.match(/const carY\s*=\s*Math.round\(booked.y\s*\+\s*booked.h\s*\*\s*(\.\d+)\)/)?.[1]);
  const bottomText = Number(email.match(/pixelLabel\("RESERVED",\s*cx,\s*b.y\s*\+\s*b.h\s*\*\s*(0?\.\d+)/)?.[1]);
  const topText = Number(email.match(/isChosen\s*\?\s*(0\.\d+)\s*:\s*0\.16/)?.[1]);
  enlarged(.83, width, "Email image width");
  enlarged(.59, height, "Email image height");
  assert.ok(width < .96, "Maintain a clean lateral margin");
  assert.ok(topText < top, "Spot label must be above vehicle");
  assert.ok(top + height < bottomText, "Car must not cover RESERVED text");
  assert.ok(bottomText < .92, "RESERVED remains within bay");
  assert.match(email, /premiumVehicleBuffer\(vehicle\)/);
  assert.match(email, /fit:\s*"contain"/);
});
