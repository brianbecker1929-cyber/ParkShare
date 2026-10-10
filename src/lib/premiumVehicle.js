// Identical selected-reservation body/colour resolution for the web and emails.
// The six masters in /public/vehicles-premium/masters are user-approved,
 // professionally rendered transparent WebPs (not the previous SVG icons).
import { getVehicleBodyType, getVehicleColourName } from "./vehicleVisuals.js";

export const PREMIUM_VEHICLE_TYPES = Object.freeze(["suv","coupe","sedan","hatchback","pickup","van"]);
export const PREMIUM_VEHICLE_COLOURS = Object.freeze([
  "Black", "White", "Silver", "Grey", "Blue", "Red", "Green",
  "Brown", "Beige", "Gold", "Yellow", "Orange", "Purple", "Burgundy", "Other",
]);
export const PREMIUM_MASTER_COLOURS = Object.freeze({
  suv: "Silver", coupe: "Orange", sedan: "Blue",
  hatchback: "Yellow", pickup: "White", van: "Grey",
});

export function premiumVehicleSpec(vehicle = {}) {
  // The image endpoint supplies a whitelisted body class directly;
  // real booking data instead resolves the selected vehicle's make/model.
  const rawBody = PREMIUM_VEHICLE_TYPES.includes(vehicle.vehicle_body_type)
    ? vehicle.vehicle_body_type : getVehicleBodyType(vehicle);
  const bodyType = PREMIUM_VEHICLE_TYPES.includes(rawBody) ? rawBody : "sedan";
  const colour = getVehicleColourName(vehicle);
  return { bodyType, colour, masterColour: PREMIUM_MASTER_COLOURS[bodyType] };
}

export function premiumVehicleUrl(vehicle = {}) {
  const { bodyType, colour } = premiumVehicleSpec(vehicle);
  return `/api/vehicle-topdown?type=${encodeURIComponent(bodyType)}&colour=${encodeURIComponent(colour)}`;
}
