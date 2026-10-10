import sharp from "sharp";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getVehicleColourHex } from "../src/lib/vehicleVisuals.js";
import { premiumVehicleSpec, PREMIUM_MASTER_COLOURS, PREMIUM_VEHICLE_TYPES, PREMIUM_VEHICLE_COLOURS } from "../src/lib/premiumVehicle.js";

const MASTER_DIR = path.join(process.cwd(), "public", "vehicles-premium", "masters");
const originals = new Map();
const tintedCache = new Map();
const MAX_CACHED = 48;
const PROFILE = {
  suv:       { kind: "metallic", minLum: .36, maxSat: .23, baseLum: .70 },
  coupe:     { kind: "paint", hue: 27, tolerance: 33, minLum: .13, minSat: .30, baseLum: .53 },
  sedan:     { kind: "paint", hue: 216, tolerance: 45, minLum: .12, minSat: .24, baseLum: .27 },
  hatchback: { kind: "paint", hue: 49, tolerance: 32, minLum: .19, minSat: .30, baseLum: .67 },
  pickup:    { kind: "metallic", minLum: .58, maxSat: .24, baseLum: .83 },
  van:       { kind: "metallic", minLum: .34, maxSat: .22, baseLum: .49 },
};
const clamp = n => Math.min(255, Math.max(0, Math.round(n)));

export function premiumMasterPath(bodyType) {
  const type = PREMIUM_VEHICLE_TYPES.includes(bodyType) ? bodyType : "sedan";
  return path.join(MASTER_DIR, `${type}.webp`);
}
function masterBuffer(type) {
  if (!originals.has(type)) originals.set(type, readFileSync(premiumMasterPath(type)));
  return originals.get(type);
}
function inPaintMask(r, g, b, p) {
  const max = Math.max(r,g,b)/255, min = Math.min(r,g,b)/255;
  const delta = max - min;
  const lum = (r*.2126 + g*.7152 + b*.0722)/255;
  const saturation = max ? delta/max : 0;
  if (p.kind === "metallic") return lum > p.minLum && saturation < p.maxSat;
  if (lum < p.minLum || saturation < p.minSat || delta < .07) return false;
  const rr=r/255, gg=g/255, bb=b/255;
  let h=0;
  if (max === rr) h=((gg-bb)/delta)%6;
  else if (max === gg) h=(bb-rr)/delta+2;
  else h=(rr-gg)/delta+4;
  h=((h*60)%360+360)%360;
  const dist=Math.abs(h-p.hue);
  return Math.min(dist,360-dist) < p.tolerance;
}

/**
 * Recolour the original photo-quality body paint; keep the same windows,
 * tyre/wheel surfaces, headlights, chrome details, transparent edges, and
 * shading. For master colours the exact approved original bytes are used.
 * Other colour options are approximate recolours of those approved masters
 * (not manufacturer-specific paint codes).
 */
export async function premiumVehicleBuffer(vehicle) {
  const {bodyType,colour,masterColour} = premiumVehicleSpec(vehicle);
  const original=masterBuffer(bodyType);
  if (colour === masterColour) return original;
  const key=bodyType+":"+colour;
  if(tintedCache.has(key))return tintedCache.get(key);
  const targetHex=getVehicleColourHex({vehicle_colour:colour});
  const tr=parseInt(targetHex.slice(1,3),16);
  const tg=parseInt(targetHex.slice(3,5),16);
  const tb=parseInt(targetHex.slice(5,7),16);
  const p=PROFILE[bodyType];
  const {data,info}=await sharp(original).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const stride=info.channels;
  for(let i=0;i<data.length;i+=stride){
    if(data[i+3]<10)continue;
    const r=data[i],g=data[i+1],b=data[i+2];
    if(!inPaintMask(r,g,b,p))continue;
    const lum=(r*.2126+g*.7152+b*.0722)/255;
    const scale=Math.max(.27, Math.min(1.75, Math.pow(lum/p.baseLum,.65)));
    const highlight = lum > p.baseLum ? (lum-p.baseLum)*25 : 0;
    // Extra highlights retain the original metallic contours.
    data[i]=clamp(tr*scale+highlight);
    data[i+1]=clamp(tg*scale+highlight);
    data[i+2]=clamp(tb*scale+highlight);
  }
  const output=await sharp(data,{raw:{width:info.width,height:info.height,channels:stride}})
    .webp({quality:86,effort:4}).toBuffer();
  if(tintedCache.size>=MAX_CACHED)tintedCache.delete(tintedCache.keys().next().value);
  tintedCache.set(key,output);
  return output;
}
