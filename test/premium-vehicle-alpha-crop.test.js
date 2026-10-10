import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { premiumVehicleBuffer, premiumMasterPath } from "../api/_premium-vehicle.js";
import { DEMO_VEHICLES } from "../api/preview-premium-vehicles.js";
import { renderParkingSpotImage } from "../api/_driveway-image.js";

async function visibleBounds(image) {
  const {data, info} = await sharp(image).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let left=info.width, top=info.height, right=-1, bottom=-1;
  for (let y=0; y<info.height; y++) for (let x=0; x<info.width; x++) {
    if (data[(y*info.width+x)*info.channels+3]<32) continue;
    left=Math.min(left,x); right=Math.max(right,x);
    top=Math.min(top,y); bottom=Math.max(bottom,y);
  }
  assert.ok(right>=left && bottom>=top, "A vehicle must remain visible");
  return {width:info.width,height:info.height,
    occupancyWidth:(right-left+1)/info.width,
    occupancyHeight:(bottom-top+1)/info.height};
}

test("all six approved photo masters render WITHOUT invisible alpha padding shrinking the visible car", async () => {
  for (const vehicle of DEMO_VEHICLES) {
    const original=await readFile(premiumMasterPath(vehicle.expected));
    const prepared=await premiumVehicleBuffer(vehicle);
    const source=await visibleBounds(original);
    const visible=await visibleBounds(prepared);
    assert.ok(visible.occupancyWidth>.91, vehicle.expected+" car should fill the available raster width, got "+visible.occupancyWidth);
    assert.ok(visible.occupancyHeight>.91, vehicle.expected+" car should fill the available raster height, got "+visible.occupancyHeight);
    assert.ok(visible.occupancyWidth>=source.occupancyWidth, "Crop must never add side padding");
    assert.ok(visible.occupancyHeight>=source.occupancyHeight, "Crop must never add vertical padding");
    assert.ok(visible.width<=source.width && visible.height<=source.height);
  }
});

test("profile vehicle colour variants receive the same tightly cropped body, not a tiny icon", async () => {
  const silverBMW=DEMO_VEHICLES[0];
  const blueBMW={...silverBMW,vehicle_colour:"Blue"};
  const silver=await premiumVehicleBuffer(silverBMW);
  const blue=await premiumVehicleBuffer(blueBMW);
  const ss=await visibleBounds(silver);
  const bs=await visibleBounds(blue);
  assert.deepEqual([ss.width,ss.height],[bs.width,bs.height]);
  assert.notDeepEqual(silver,blue,"Colour must still change");
  assert.ok(bs.occupancyWidth>.91 && bs.occupancyHeight>.91);
});

test("Renter/Host confirmation diagrams still rasterize approved SUV and coupe snapshots", async () => {
  for (const vehicle of DEMO_VEHICLES.slice(0,2)) {
    const buffer=await renderParkingSpotImage([true,false,false,false],0,vehicle);
    const info=await sharp(buffer).metadata();
    assert.equal(info.format,"png");
    assert.equal(info.width,1000);
    assert.ok(buffer.length>10000);
  }
});
