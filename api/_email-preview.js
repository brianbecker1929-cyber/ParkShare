// Fixed, synthetic examples only. These selectors never read customer records.
const VEHICLES = {
  orange: { vehicle_make: "Lexus", vehicle_model: "LC", vehicle_colour: "Orange" },
  silver: { vehicle_make: "BMW", vehicle_model: "X4", vehicle_colour: "Silver" },
  yellow: { vehicle_make: "INFINITI", vehicle_model: "Q30", vehicle_colour: "Yellow" },
  black: { vehicle_make: "Honda", vehicle_model: "Civic", vehicle_colour: "Black" },
  red: { vehicle_make: "Ford", vehicle_model: "F-150", vehicle_colour: "Red" },
  blue: { vehicle_make: "Toyota", vehicle_model: "Sienna", vehicle_colour: "Blue" },
};

export function sampleEmailBooking(query = {}) {
  const colour = typeof query.vehicle === "string" && Object.hasOwn(VEHICLES, query.vehicle) ? query.vehicle : "orange";
  const spotLabel = typeof query.spot === "string" && /^[A-D]$/.test(query.spot) ? query.spot : "B";
  const chosenIndex = spotLabel.charCodeAt(0) - 65;
  return {
    vehicle: { ...VEHICLES[colour], license_plate: "DEMO 123" },
    spotLabel,
    chosenIndex,
    spotStates: Array.from({ length: 4 }, (_, i) => i === chosenIndex),
  };
}
