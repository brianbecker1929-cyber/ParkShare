import {VEHICLE_MODELS, VEHICLE_COLOURS} from './vehicleOptions.js';

import {normaliseVehicleType} from './vehicleTypes.js';

// A booking vehicle is required for either account role. Only these fields
// cross the booking editor boundary; names, roles and guest vehicles do not.
export function validateBookingVehicle(input = {}) {
  const vehicle = Object.fromEntries(['vehicleType','vehicleMake','vehicleModel','vehicleColour','licensePlate']
    .map(key => [key, typeof input?.[key] === 'string' ? input[key].trim() : '']));
  vehicle.licensePlate = vehicle.licensePlate.toUpperCase();
  const errors = {};
  if (input?.vehicleType && !normaliseVehicleType(input.vehicleType)) errors.vehicleType = 'Select a valid vehicle type.';
  vehicle.vehicleType = normaliseVehicleType(vehicle.vehicleType);
  if (!Object.hasOwn(VEHICLE_MODELS,vehicle.vehicleMake)) errors.vehicleMake = 'Select your vehicle make.';
  if (!Object.hasOwn(VEHICLE_MODELS,vehicle.vehicleMake) || !VEHICLE_MODELS[vehicle.vehicleMake].includes(vehicle.vehicleModel)) errors.vehicleModel = 'Select a model for the chosen make.';
  if (!VEHICLE_COLOURS.includes(vehicle.vehicleColour)) errors.vehicleColour = 'Select your vehicle colour.';
  if (!/^[A-Z0-9 -]{2,15}$/.test(vehicle.licensePlate)) errors.licensePlate = 'Enter a valid license plate using letters and numbers.';
  return {vehicle,errors,valid:Object.keys(errors).length===0};
}

export function bookingVehicleMetadata(vehicle) {
  return {vehicle_type:normaliseVehicleType(vehicle.vehicleType),vehicle_make:vehicle.vehicleMake,vehicle_model:vehicle.vehicleModel,
    vehicle_colour:vehicle.vehicleColour,license_plate:vehicle.licensePlate,
    vehicle_details:`${vehicle.vehicleColour} ${vehicle.vehicleMake} ${vehicle.vehicleModel}`};
}
