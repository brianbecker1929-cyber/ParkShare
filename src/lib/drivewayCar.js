// A single, colour-matched bird's-eye car used by the spot picker, booking
// details, host dashboard and Stripe confirmation email PNG. Keep this SVG
// independent of browser APIs so the server-side email renderer can reuse it.
import { getVehicleBodyType, getVehicleColourHex } from "./vehicleVisuals.js";

export function hasDrivewayVehicle(vehicle) {
  return Boolean(vehicle && (vehicle.vehicleMake || vehicle.vehicle_make || vehicle.vehicleModel || vehicle.vehicle_model || vehicle.vehicleColour || vehicle.vehicle_colour));
}

// The shape is drawn facing the garage (up in the driveway template).
// Coordinates use an invariant 96 x 188 space so CSS and server PNG overlays
// use exactly the same artwork, independent of vehicle-image assets.
export function drivewayCarShapes(vehicle = {}) {
  const colour = getVehicleColourHex(vehicle);
  const body = getVehicleBodyType(vehicle);
  const tall = body === "suv" || body === "van" || body === "pickup";
  const roofStart = tall ? 46 : 55;
  const roofEnd = body === "pickup" ? 112 : tall ? 140 : 132;
  const pickupBed = body === "pickup"
    ? '<rect x="22" y="123" width="52" height="37" rx="3" fill="#19293A" fill-opacity=".15" stroke="#14283C" stroke-opacity=".45" stroke-width="2"/>'
    : "";
  return `
    <ellipse cx="48" cy="97" rx="43" ry="84" fill="#102034" opacity=".20"/>
    <rect x="4" y="42" width="13" height="37" rx="5" fill="#202935"/>
    <rect x="79" y="42" width="13" height="37" rx="5" fill="#202935"/>
    <rect x="4" y="112" width="13" height="37" rx="5" fill="#202935"/>
    <rect x="79" y="112" width="13" height="37" rx="5" fill="#202935"/>
    <rect x="14" y="10" width="68" height="168" rx="20" fill="${colour}" stroke="#12253C" stroke-width="3"/>
    <path d="M24 22 Q48 13 72 22" stroke="#FFFFFF" stroke-opacity=".48" stroke-width="4" fill="none"/>
    <rect x="20" y="27" width="56" height="29" rx="8" fill="#203A4C" stroke="#DCE9ED" stroke-width="2"/>
    <path d="M23 48 L69 34" stroke="#E0F4FA" stroke-width="5" stroke-opacity=".28"/>
    <rect x="20" y="${roofStart}" width="56" height="${roofEnd - roofStart}" rx="10" fill="${colour}" stroke="#17283A" stroke-opacity=".65" stroke-width="2"/>
    <path d="M23 ${roofStart + 8} L23 ${roofEnd - 8} M73 ${roofStart + 8} L73 ${roofEnd - 8}" stroke="#FFFFFF" stroke-opacity=".27" stroke-width="3"/>
    <rect x="20" y="${roofEnd}" width="56" height="23" rx="7" fill="#253E51" stroke="#DCE9ED" stroke-width="2"/>
    <path d="M24 ${roofEnd + 16} L68 ${roofEnd + 5}" stroke="#E0F4FA" stroke-width="4" stroke-opacity=".22"/>
    ${pickupBed}
    <path d="M25 166 L71 166" stroke="#112638" stroke-width="3" stroke-opacity=".55"/>
    <rect x="22" y="12" width="14" height="5" rx="2" fill="#FFF5CF"/>
    <rect x="60" y="12" width="14" height="5" rx="2" fill="#FFF5CF"/>
    <rect x="22" y="173" width="14" height="5" rx="2" fill="#C93E32"/>
    <rect x="60" y="173" width="14" height="5" rx="2" fill="#C93E32"/>
  `;
}

export function drivewayCarSvg(vehicle = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="188" viewBox="0 0 96 188" role="img" aria-label="Top view of parked car">${drivewayCarShapes(vehicle)}</svg>`;
}

export function drivewayCarDataUrl(vehicle = {}) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(drivewayCarSvg(vehicle))}`;
}
