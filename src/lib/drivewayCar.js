// ParkShare's single deterministic premium top-down vehicle renderer.
// Shared by SpotPicker, payment review, Driver/Host booking cards and
// api/_driveway-image.js (Stripe-email PNG). No browser APIs or remote assets.
// This depicts the selected vehicle's body class and colour; it is not a
// photo or exact CAD model of the specific make/model.
import { getVehicleBodyType, getVehicleColourHex } from "./vehicleVisuals.js";

const VEHICLE_TYPES = new Set(["sedan", "suv", "coupe", "hatchback", "pickup", "van"]);

export function hasDrivewayVehicle(vehicle) {
  return Boolean(vehicle && (vehicle.vehicleMake || vehicle.vehicle_make || vehicle.vehicleModel || vehicle.vehicle_model || vehicle.vehicleColour || vehicle.vehicle_colour));
}

export function getDrivewayVehicleSpec(vehicle = {}) {
  const type = getVehicleBodyType(vehicle);
  const bodyType = VEHICLE_TYPES.has(type) ? type : "sedan";
  // Only a trusted literal hex is interpolated into the SVG. The colour
  // utility normalizes profile input, so we never interpolate raw user text.
  const colour = getVehicleColourHex(vehicle);
  const shape = {
    coupe:     { halfWidth: 33, top: 11, bottom: 179, radius: 22, windowFront: 46, windowRear: 133, cabinTop: 68, cabinBottom: 122 },
    sedan:     { halfWidth: 35, top: 9, bottom: 180, radius: 17, windowFront: 41, windowRear: 139, cabinTop: 60, cabinBottom: 127 },
    hatchback: { halfWidth: 36, top: 15, bottom: 178, radius: 19, windowFront: 42, windowRear: 150, cabinTop: 59, cabinBottom: 137 },
    suv:       { halfWidth: 39, top: 8, bottom: 181, radius: 16, windowFront: 35, windowRear: 153, cabinTop: 52, cabinBottom: 141 },
    pickup:    { halfWidth: 38, top: 8, bottom: 182, radius: 12, windowFront: 41, windowRear: 101, cabinTop: 56, cabinBottom: 101 },
    van:       { halfWidth: 39, top: 7, bottom: 183, radius: 13, windowFront: 28, windowRear: 157, cabinTop: 43, cabinBottom: 146 },
  }[bodyType];
  return { bodyType, colour, ...shape };
}

// The exact 96 x 188 viewbox used in both React data:image/svg and Sharp's
// server-side email PNG. Vehicle points UP, toward the garage.
// Subtle gradients, sculpted hoods, real window geometry, reflected glass,
// glass roof, mirrors, lights, and detailed tyre sidewalls replace the small
// flat cartoon icon. Body shapes vary (especially pickup bed and coupe cabin).
export function drivewayCarShapes(vehicle = {}) {
  const spec = getDrivewayVehicleSpec(vehicle);
  const { bodyType: body, colour, halfWidth: w, top: t, bottom: b,
    radius: r, windowFront: wf, windowRear: wr, cabinTop: ct, cabinBottom: cb } = spec;
  const x1 = 48 - w, x2 = 48 + w;
  const middleWidth = 2 * w - 11;
  const cabinL = x1 + 8, cabinR = x2 - 8;
  const cabinWidth = cabinR - cabinL;
  const isPickup = body === "pickup";
  const isCoupe = body === "coupe";
  const isVan = body === "van";
  const isSUV = body === "suv";
  const isHatch = body === "hatchback";
  const hoodY = wf - (isVan ? 9 : 13);
  const rearTrunkY = wr + (isHatch ? 8 : isPickup ? 6 : 13);
  const frontGlassPath = `M${cabinL + 3} ${wf + 3} Q48 ${wf - (isVan ? 3 : 9)} ${cabinR - 3} ${wf + 3} L${cabinR - 3} ${ct + 10} Q48 ${ct + 2} ${cabinL + 3} ${ct + 10} Z`;
  const rearGlassPath = `M${cabinL + 3} ${cb - 6} Q48 ${cb - 2} ${cabinR - 3} ${cb - 6} L${cabinR - 3} ${wr - 1} Q48 ${wr + (isCoupe ? 12 : 5)} ${cabinL + 3} ${wr - 1} Z`;
  const contour = `M48 ${t + 2} C${x2 - 12} ${t + 3} ${x2} ${t + 11} ${x2} ${t + r} L${x2} ${b - r} C${x2} ${b - 8} ${x2 - 10} ${b} 48 ${b} C${x1 + 10} ${b} ${x1} ${b - 8} ${x1} ${b - r} L${x1} ${t + r} C${x1} ${t + 9} ${x1 + 13} ${t + 2} 48 ${t + 2} Z`;
  const bed = isPickup ? `
    <rect data-ps-pickup-bed="true" x="${cabinL - 1}" y="111" width="${cabinWidth + 2}" height="53" rx="5" fill="#0D253C" opacity=".37" />
    <rect x="${cabinL + 2}" y="114" width="${cabinWidth - 4}" height="45" rx="3" fill="url(#ps-glass)" opacity=".45" />
    <path d="M${cabinL + 7} 116 V154 M48 116 V154 M${cabinR - 7} 116 V154 M${cabinL + 2} 160 H${cabinR - 2}" stroke="#DCE8F0" opacity=".35" stroke-width="1.8"/>
  ` : "";
  const panoramic = (isSUV || isVan)
    ? `<rect x="${cabinL + 10}" y="${ct + 13}" width="${cabinWidth - 20}" height="${Math.max(18,cb - ct - 27)}" rx="6" fill="url(#ps-glass)" opacity=".77" stroke="#D2E2ED" stroke-opacity=".55" stroke-width="1.3"/>`
    : `<path d="M${cabinL + 10} ${ct + 21} Q48 ${ct + 11} ${cabinR - 10} ${ct + 21} L${cabinR - 10} ${cb - 17} Q48 ${cb - 11} ${cabinL + 10} ${cb - 17}Z" fill="${colour}" opacity=".65" stroke="#EAF4F8" stroke-opacity=".4" stroke-width="1.2"/>`;
  const sideGlass = isPickup ? "" : `
    <path d="M${cabinL - 1} ${ct + 12} Q${cabinL - 4} ${ct + 27} ${cabinL - 1} ${cb - 7} L${cabinL + 6} ${cb - 9} V${ct + 17}Z" fill="url(#ps-glass)" stroke="#DAE6EE" stroke-opacity=".43" stroke-width="1"/>
    <path d="M${cabinR + 1} ${ct + 12} Q${cabinR + 4} ${ct + 27} ${cabinR + 1} ${cb - 7} L${cabinR - 6} ${cb - 9} V${ct + 17}Z" fill="url(#ps-glass)" stroke="#DAE6EE" stroke-opacity=".43" stroke-width="1"/>`;
  return `
    <defs>
      <linearGradient id="ps-paint" x1="0" y1="0" x2="1" y2=".33">
        <stop offset="0" stop-color="#101B29" stop-opacity=".3"/>
        <stop offset=".19" stop-color="#FFFFFF" stop-opacity=".22"/>
        <stop offset=".48" stop-color="#FFFFFF" stop-opacity=".04"/>
        <stop offset=".8" stop-color="#050E19" stop-opacity=".24"/>
        <stop offset="1" stop-color="#050E19" stop-opacity=".42"/>
      </linearGradient>
      <linearGradient id="ps-glass" x1=".05" y1="0" x2=".94" y2="1">
        <stop offset="0" stop-color="#9FBCCC"/>
        <stop offset=".21" stop-color="#4E697B"/>
        <stop offset=".52" stop-color="#142A40"/>
        <stop offset=".84" stop-color="#102037"/>
        <stop offset="1" stop-color="#516E82"/>
      </linearGradient>
      <linearGradient id="ps-wind-reflection" x1="0" y1="0" x2=".7" y2="1">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity=".58"/>
        <stop offset=".35" stop-color="#EDF8FF" stop-opacity=".19"/>
        <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <ellipse cx="48" cy="100" rx="${w+5}" ry="88" fill="#0B1826" opacity=".15"/>
    <path d="${contour}" fill="#0B1826" opacity=".16" transform="translate(0 3.5)"/>
    ${[35,129].map(y=>`
      <rect x="${x1 - 7}" y="${y}" width="12" height="29" rx="4" fill="#111923"/>
      <rect x="${x2 - 5}" y="${y}" width="12" height="29" rx="4" fill="#111923"/>
      <path d="M${x1 - 5} ${y+4}v21 M${x2+5} ${y+4}v21" stroke="#788591" stroke-width="1.1" opacity=".6"/>`).join("")}
    <path d="${contour}" fill="${colour}" stroke="#263443" stroke-width="1.75" stroke-linejoin="round"/>
    <path d="${contour}" fill="url(#ps-paint)"/>
    <path d="M${x1+8} ${t+18} Q${x1+4} 97 ${x1+8} ${b-16} M${x2-8} ${t+18} Q${x2-4} 97 ${x2-8} ${b-16}"
          fill="none" stroke="#FFFFFF" stroke-opacity=".33" stroke-width="2.5"/>
    <path d="M${x1+13} ${t+8} Q48 ${t+3} ${x2-13} ${t+8}"
          fill="none" stroke="#FFFFFF" stroke-opacity=".54" stroke-width="2"/>
    <path d="M${x1+9} ${hoodY} Q48 ${hoodY-4} ${x2-9} ${hoodY}" stroke="#0D2436" stroke-opacity=".34" stroke-width="1.5" fill="none"/>
    <path d="M${x1+10} ${hoodY-5} Q48 ${t+8} ${x2-10} ${hoodY-5}" stroke="#FFFFFF" stroke-opacity=".2" stroke-width="2" fill="none"/>
    ${[x1-4,x2-5].map(x=>`<path d="M${x} ${ct+1}l${x<48?-7:7} -9 q4 -2 5 3 l0 13" fill="${colour}" stroke="#243344" stroke-width="1.5"/>`).join("")}
    <path d="${frontGlassPath}" fill="url(#ps-glass)" stroke="#D0E4ED" stroke-opacity=".76" stroke-width="1.8"/>
    <path d="${frontGlassPath}" fill="url(#ps-wind-reflection)" opacity=".47"/>
    <path d="M${cabinL+6} ${wf+7}L${cabinR-12} ${ct+11}" stroke="#E5F3FB" stroke-width="3.5" stroke-opacity=".3"/>
    <path d="M${cabinL+3} ${ct+10}Q48 ${ct+5} ${cabinR-3} ${ct+10}L${cabinR-3} ${cb-6}Q48 ${cb-4} ${cabinL+3} ${cb-6}Z"
          fill="${colour}" stroke="#1D2A37" stroke-opacity=".6" stroke-width="1.4"/>
    ${sideGlass}
    ${panoramic}
    ${isCoupe ? `<path d="M${cabinL+3} ${ct+9} Q48 ${ct-3} ${cabinR-3} ${ct+9}" fill="none" stroke="#E8F1FA" stroke-opacity=".5" stroke-width="2"/>` : ""}
    <path d="${rearGlassPath}" fill="url(#ps-glass)" stroke="#E0EAF2" stroke-opacity=".6" stroke-width="1.7"/>
    <path d="M${cabinL+9} ${cb+1}L${cabinR-13} ${wr-2}" stroke="#D2ECFC" stroke-width="3.5" opacity=".19"/>
    ${bed}
    <path d="M${x1+10} ${rearTrunkY}Q48 ${rearTrunkY+4} ${x2-10} ${rearTrunkY}" stroke="#1C2B3D" stroke-opacity=".45" stroke-width="1.7" fill="none"/>
    <path d="M${x1+10} ${b-13}Q48 ${b-8} ${x2-10} ${b-13}" stroke="#0C1C2D" stroke-opacity=".36" fill="none" stroke-width="1.8"/>
    <path d="M${x1+11} ${t+8}h13 M${x2-24} ${t+8}h13" stroke="#F8F2D5" stroke-width="4.1" stroke-linecap="round" opacity=".94"/>
    <path d="M${x1+11} ${b-8}h13 M${x2-24} ${b-8}h13" stroke="#CB302E" stroke-width="3.7" stroke-linecap="round"/>
    <path d="M${x1+9} ${b-5}H${x2-9}" stroke="#E8F2FA" stroke-opacity=".37" stroke-width="1"/>
  `;
}

export function drivewayCarSvg(vehicle = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="376" viewBox="0 0 96 188" role="img" aria-label="Premium top-down vehicle illustration">${drivewayCarShapes(vehicle)}</svg>`;
}

export function drivewayCarDataUrl(vehicle = {}) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(drivewayCarSvg(vehicle))}`;
}
