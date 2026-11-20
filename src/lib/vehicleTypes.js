// Vehicle body class is separate from the primary/guest profile identifier.
export const VEHICLE_TYPES = Object.freeze({
  sedan: 'Sedan', suv: 'SUV / crossover', coupe: 'Coupe / sports car',
  hatchback: 'Hatchback', pickup: 'Pickup truck', van: 'Van / minivan',
});

export function normaliseVehicleType(value) {
  const type = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return Object.hasOwn(VEHICLE_TYPES, type) ? type : '';
}
