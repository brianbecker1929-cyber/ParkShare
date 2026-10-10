import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import {
  drivewayCarDataUrl, drivewayCarShapes, drivewayCarSvg,
  getDrivewayVehicleSpec, hasDrivewayVehicle,
} from "../src/lib/drivewayCar.js";
import { getVehicleBodyType, getVehicleColourName } from "../src/lib/vehicleVisuals.js";
import { DEMO_VEHICLES, default as galleryPreview } from "../api/preview-premium-vehicles.js";
import { renderParkingSpotImage } from "../api/_driveway-image.js";
import { premiumVehicleSpec, premiumVehicleUrl, PREMIUM_MASTER_COLOURS } from "../src/lib/premiumVehicle.js";
import { premiumVehicleBuffer, premiumMasterPath } from "../api/_premium-vehicle.js";
import vehicleEndpoint from "../api/vehicle-topdown.js";

test("selected reservation snapshots resolve 6 distinct vehicle body classes", () => {
  assert.equal(DEMO_VEHICLES.length, 6);
  for (const vehicle of DEMO_VEHICLES) {
    assert.equal(getVehicleBodyType(vehicle), vehicle.expected, vehicle.label);
    assert.equal(getDrivewayVehicleSpec(vehicle).bodyType, vehicle.expected);
    assert.ok(hasDrivewayVehicle(vehicle));
  }
  const silverX4 = { vehicleMake: "BMW", vehicleModel: "X4", vehicleColour: "Silver" };
  assert.equal(getDrivewayVehicleSpec(silverX4).bodyType, "suv");
  assert.equal(getDrivewayVehicleSpec(silverX4).colour, "#BFC5CA");
  assert.equal(getVehicleBodyType({ vehicle_make: "bmw", vehicle_model: "x4 m" }), "suv");
  assert.equal(getVehicleColourName({ vehicle_colour: "silver" }), "Silver");
  assert.equal(getVehicleColourName({ vehicle_colour: "GRAY" }), "Grey");
  assert.equal(getDrivewayVehicleSpec({ vehicle_colour: "<script>"}).colour, "#87939C");
});

test("premium shared SVG uses real body-specific silhouettes and layered details", async () => {
  const renders = [];
  for (const v of DEMO_VEHICLES) {
    const svg = drivewayCarSvg(v);
    assert.match(svg, /viewBox="0 0 96 188"/);
    assert.match(svg, /ps-paint/);
    assert.match(svg, /ps-glass/);
    assert.match(svg, /ps-wind-reflection/);
    assert.match(svg, /stroke-opacity/);
    assert.doesNotMatch(svg, /undefined|NaN|<script>/);
    const buffer = await sharp(Buffer.from(svg)).resize(192, 376).png().toBuffer();
    const info = await sharp(buffer).metadata();
    assert.equal(info.width, 192);
    assert.equal(info.height, 376);
    renders.push(buffer.toString("base64"));
    const uri = drivewayCarDataUrl(v);
    assert.match(decodeURIComponent(uri), /Premium top-down vehicle illustration/);
  }
  assert.equal(new Set(renders).size, 6, "six visual silhouettes/colours must be distinct");
  assert.match(drivewayCarShapes(DEMO_VEHICLES[4]), /data-ps-pickup-bed="true"/, "pickup has distinct cargo bed");
  assert.doesNotMatch(drivewayCarShapes(DEMO_VEHICLES[0]), /data-ps-pickup-bed="true"/, "SUV has no pickup bed");
});

test("email PNG uses exact shared SVG and enlarges booked vehicle inside Spot B", async () => {
  const silver = DEMO_VEHICLES[0];
  const orange = DEMO_VEHICLES[1];
  const [silverImg, orangeImg] = await Promise.all([
    renderParkingSpotImage([false,true,false,false], 1, silver),
    renderParkingSpotImage([false,true,false,false], 1, orange),
  ]);
  const [a,b] = await Promise.all([sharp(silverImg).metadata(),sharp(orangeImg).metadata()]);
  assert.equal(a.width, 500);
  assert.equal(b.width, 500);
  assert.equal(a.format, "png");
  assert.notDeepEqual(silverImg, orangeImg);
  const email = await readFile(new URL("../api/_driveway-image.js", import.meta.url), "utf8");
  assert.match(email, /premiumVehicleBuffer\(vehicle\)/);
  assert.match(email, /booked\.w \* \.96/);
  assert.match(email, /booked\.h \* \.76/);
  assert.match(email, /pixelLabel\("RESERVED"/);
  assert.match(email, /pixelLabel\(`SPOT/);
});

test("App's SpotPicker and both booking dashboards reuse the premium shared car", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(app, /function DrivewayCarVisual\(\{ vehicle \}\)/);
  assert.match(app, /src=\{premiumVehicleUrl\(vehicle\)\}/);
  assert.match(app, /<SpotPicker/);
  assert.match(app, /<BookingParkingDetails listing=\{b\.listingDetails\} spotLabel=\{b\.spotLabel\} vehicle=\{b\.vehicle\} \/>/);
  assert.match(app, /<BookingParkingDetails listing=\{b\.listing\} spotLabel=\{b\.spotLabel\} vehicle=\{b\.vehicle\}/);
  assert.match(styles, /\.ps-driveway-car-roof\s*\{[\s\S]*?height: 79%/);
  assert.match(styles, /\.ps-booked-spot > img\.ps-driveway-car-roof\s*\{[\s\S]*?height: 79%/);
});

function fakeResponse() {
  return { code:200, headers:{}, body:"",
    status(n) {this.code=n;return this;},
    setHeader(k,v){this.headers[k]=v;return this;},
    end(s){this.body=s;return this;},
    send(s){this.body=s;return this;},
  };
}
test("vehicle gallery is sample-only, guarded from production, and contains all six cases", async () => {
  const before = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    const prod = fakeResponse();
    await galleryPreview({ method: "GET" }, prod);
    assert.equal(prod.code, 404);
    process.env.VERCEL_ENV = "preview";
    const demo = fakeResponse();
    await galleryPreview({ method: "GET" }, demo);
    assert.equal(demo.code, 200);
    assert.equal(demo.headers["Cache-Control"], "no-store");
    assert.equal(demo.headers["X-Robots-Tag"], "noindex, nofollow");
    for (const vehicle of DEMO_VEHICLES) assert.ok(demo.body.includes(vehicle.label), vehicle.label);
    assert.equal((demo.body.match(/data:image\/png;base64,/g) || []).length, 6);
    assert.equal((demo.body.match(/data:image\/webp;base64,/g) || []).length, 6);
  } finally {
    if (before === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = before;
  }
});


test("six approved actual WebP master files have real photographic detail", async () => {
  for (const body of ["suv","coupe","sedan","hatchback","pickup","van"]) {
    const bytes=await readFile(premiumMasterPath(body));
    const info=await sharp(bytes).metadata();
    assert.equal(info.format,"webp");
    assert.equal(info.channels,4);
    assert.ok(info.width>=350 && info.height>=550,body+" image too small");
    assert.ok(bytes.length>=30000,body+" should be the approved detailed image");
  }
});

test("booking colour and body style map to approved artwork and recolour variants", async () => {
  for(const v of DEMO_VEHICLES){
    const spec=premiumVehicleSpec(v);
    assert.equal(spec.bodyType,v.expected);
    assert.equal(spec.colour,v.vehicle_colour);
    assert.match(premiumVehicleUrl(v), /^\/api\/vehicle-topdown\?type=/);
    const image=await premiumVehicleBuffer(v);
    assert.equal((await sharp(image).metadata()).format,"webp");
    assert.ok(image.length>9000);
  }
  assert.equal(PREMIUM_MASTER_COLOURS.coupe,"Orange");
  assert.equal(PREMIUM_MASTER_COLOURS.suv,"Silver");
  const blueSUV=await premiumVehicleBuffer({...DEMO_VEHICLES[0],vehicle_colour:"Blue"});
  const silverSUV=await premiumVehicleBuffer(DEMO_VEHICLES[0]);
  assert.notDeepEqual(blueSUV,silverSUV);
});

test("public vehicle WebP API rejects unsafe body and colour values", async () => {
  const res=fakeResponse();
  await vehicleEndpoint({method:"GET",query:{type:"suv",colour:"Silver"}},res);
  assert.equal(res.code,200);
  assert.equal(res.headers["Content-Type"],"image/webp");
  assert.equal((await sharp(res.body).metadata()).format,"webp");
  assert.ok(String(res.headers["Cache-Control"]).includes("s-maxage"));
  for (const [type,colour] of [["../../secret","Orange"],["suv","<script>"]]) {
    const bad=fakeResponse();
    await vehicleEndpoint({method:"GET",query:{type,colour}},bad);
    assert.equal(bad.code,400);
  }
  const noPost=fakeResponse();
  await vehicleEndpoint({method:"POST",query:{type:"suv",colour:"Silver"}},noPost);
  assert.equal(noPost.code,405);
});
