// Public, cacheable image rendition. The URL contains ONLY a vetted type and
// colour; no personal information, profile IDs, booking IDs, or API credentials.
import { premiumVehicleBuffer } from "./_premium-vehicle.js";
import { PREMIUM_VEHICLE_TYPES, PREMIUM_VEHICLE_COLOURS } from "../src/lib/premiumVehicle.js";

export default async function handler(req,res) {
  if(req.method !== "GET") {
    res.setHeader("Allow","GET");
    return res.status(405).end("Method not allowed");
  }
  const { type, colour }=req.query||{};
  if(typeof type!=="string" || typeof colour!=="string" ||
     !PREMIUM_VEHICLE_TYPES.includes(type) || !PREMIUM_VEHICLE_COLOURS.includes(colour)){
    return res.status(400).end("Unsupported vehicle");
  }
  try{
    // The explicit class is checked against the fixed six-class allowlist.
    const file=await premiumVehicleBuffer({vehicle_colour:colour,vehicle_body_type:type});
    res.setHeader("Content-Type","image/webp");
    res.setHeader("Cache-Control","public, s-maxage=86400, stale-while-revalidate=604800");
    res.setHeader("X-Content-Type-Options","nosniff");
    return res.status(200).end(file);
  }catch(err){
    console.error("Premium car image failed:",err);
    return res.status(500).end("Vehicle image unavailable");
  }
}
