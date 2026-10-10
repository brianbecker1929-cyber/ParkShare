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
  assert.match(picker, /<span className="ps-spot-picker-label"/);
  assert.match(picker, /fontSize: isChosen \? 12 : 13/);
  assert.match(picker, />Spot \{l\}<\/span>/);
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
  assert.match(picker, /padding: isChosen \? "10px 5px 5px" : "3% 3%"/, "Maintain label-to-border clearance and existing other-bay padding");
  assert.match(picker, /overflow: "hidden"/,"Keep car inside reserved bay");
  assert.match(picker, /border: isChosen \? "4px solid " \+ C\.hazard/,"Keep orange selected outline");
});

test("Dashboard keeps RESERVED status; email vehicle uses the approved picker footprint", async () => {
  const app=await read("../src/App.jsx");
  const booked=app.slice(app.indexOf("function BookedSpotDiagram("),app.indexOf("function BookingParkingDetails("));
  assert.match(booked, /isSelected \? "RESERVED" : isRentable/);
  assert.match(booked, /<DrivewayCarVisual vehicle=\{vehicle\} \/>/);
  const email=await read("../api/_driveway-image.js");
  assert.doesNotMatch(email,/pixelLabel\("RESERVED"/);
  assert.match(email,/premiumVehicleBuffer\(vehicle\)/);
});


test("SpotPicker renders the selected primary vehicle immediately without generic cartoon car", async () => {
  const app=await read("../src/App.jsx");
  const listing=app.slice(app.indexOf("function ListingDetail("),app.indexOf("function DrivewayFrame("));
  const picker=app.slice(app.indexOf("function SpotPicker("),app.indexOf("// Read-only booking view shared"));
  assert.match(listing,/const \[selectedVehicleId, setSelectedVehicleId\] = useState\(""\)/);
  assert.match(listing,/const defaultVehicle = existingVehicle/);
  assert.match(listing,/bookableVehicles\.find\(vehicle => vehicle\.id === "primary"\)/);
  assert.match(listing,/if \(!existingVehicle && defaultVehicle\) setSelectedVehicleId\(defaultVehicle\.id\)/);
  assert.match(listing,/setSpotVehiclePickerOpen\(!defaultVehicle\)/);
  assert.match(listing,/vehicle=\{selectedVehicle\}/);
  assert.match(picker,/isChosen && hasDrivewayVehicle\(vehicle\)/);
  assert.match(picker,/isChosen \? \(\s*<span className="ps-spot-picker-no-vehicle">Select vehicle<\/span>/);
  assert.match(picker,/!isChosen && \(/,"Available and not-for-rent bays retain their labels");
  assert.match(listing,/setSelectedVehicleId\(vehicle\.id\); setSpotVehiclePickerOpen\(false\)/);
});

test("orange selected outline cannot obscure the Spot A or Spot B heading", async () => {
  const app=await read("../src/App.jsx");
  const picker=app.slice(app.indexOf("function SpotPicker("),app.indexOf("// Read-only booking view shared"));
  assert.match(picker,/padding: isChosen \? "10px 5px 5px" : "3% 3%"/);
  assert.match(picker,/border: isChosen \? "4px solid " \+ C\.hazard/);
  assert.match(picker,/fontSize: isChosen \? 12 : 13/);
  assert.match(picker,/const labels = \["A", "B", "C", "D"\]/, "Apply the same protection to every parking bay");
  assert.match(picker,/lineHeight: 1\.25,/, "Keep the original label row height and vehicle area");
  assert.match(picker,/textAlign: "center", width: "100%", boxSizing: "border-box"/, "Keep selected label within the bay's inner width");
  assert.match(picker,/paddingRight: isChosen \? 4 : 0/, "Nudge text to the left only on selected spots");
  assert.match(picker,/transform: isChosen \? "scaleX\(0\.86\)" : undefined/, "Condense only selected spot text to leave clearance around orange ring");
  assert.match(picker,/gridTemplateRows: isChosen \? "min-content minmax\(0, 1fr\)"/);
});
