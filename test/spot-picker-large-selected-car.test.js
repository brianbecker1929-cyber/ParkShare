import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = file => readFile(new URL(file, import.meta.url), "utf8");

test("selected booking bay removes only Your spot, leaving Spot label visible", async () => {
  const app=await read("../src/App.jsx");
  const start=app.indexOf("function SpotPicker(");
  const end=app.indexOf("// Read-only booking view shared",start);
  assert.ok(start>0 && end>start);
  const picker=app.slice(start,end);
  assert.doesNotMatch(picker, /isChosen \? "Your spot"/, "Selected SpotPicker should not render the removed footer");
  assert.match(picker, /<span style=\{\{ fontWeight: 800, fontSize: 13, whiteSpace: "nowrap", flexShrink: 0 \}\}>Spot \{l\}<\/span>/);
  assert.match(picker, /ps-spot-picker-bay/);
  assert.match(picker, /gridTemplateRows: isChosen \? "min-content minmax\(0, 1fr\)"/);
  assert.match(picker, /display: isChosen \? "grid" : "flex"/);
  assert.match(picker, /\{!isChosen && \(/, "Keep available and not-for-rent labels for other bays");
  assert.match(picker, /isAvailable \? "Available" : !hostEnabled \? "Not for rent" : "Already booked"/);
  assert.match(picker, /isChosen && hasDrivewayVehicle\(vehicle\)/);
  assert.match(picker, /<DrivewayCarVisual vehicle=\{vehicle\} \/>/);
  assert.match(picker, /onClick=\{\(\) => isAvailable && onChoose\(i\)\}/);
});

test("selected car uses all of remaining bay without overflow or pixel caps", async () => {
  const css=await read("../src/index.css");
  const selector=".ps-spot-picker-bay.is-selected > img.ps-driveway-car-roof";
  const index=css.indexOf(selector+" {");
  assert.ok(index>=0,"Missing scoped selected bay styling");
  const begin=css.indexOf("{",index);
  const styles=css.slice(begin+1,css.indexOf("}",begin));
  for(const declaration of [
    "width: 100%", "height: 100%", "max-height: 100%",
    "max-width: none", "object-fit: contain", "min-height: 0",
    "justify-self: center", "align-self: center"
  ])assert.ok(styles.includes(declaration),declaration);
  const app=await read("../src/App.jsx");
  const picker=app.slice(app.indexOf("function SpotPicker("),app.indexOf("// Read-only booking view shared"));
  assert.match(picker, /padding: "3% 3%"/,"Keep side margins from button padding");
  assert.match(picker, /overflow: "hidden"/,"Keep car inside reserved bay");
  assert.match(picker, /border: isChosen \? "4px solid " \+ C\.hazard/,"Keep orange selected outline");
});

test("Host/Driver completed booking and both email diagrams retain RESERVED labels", async () => {
  const app=await read("../src/App.jsx");
  const booked=app.slice(app.indexOf("function BookedSpotDiagram("),app.indexOf("function BookingParkingDetails("));
  assert.match(booked, /isSelected \? "RESERVED" : isRentable/);
  assert.match(booked, /<DrivewayCarVisual vehicle=\{vehicle\} \/>/);
  const email=await read("../api/_driveway-image.js");
  assert.match(email,/pixelLabel\("RESERVED"/);
  assert.match(email,/premiumVehicleBuffer\(vehicle\)/);
});
