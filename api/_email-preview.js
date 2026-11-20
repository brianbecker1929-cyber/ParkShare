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
  const count = typeof query.spaces === "string" && /^[1-8]$/.test(query.spaces) ? Number(query.spaces) : 4;
  const requested = typeof query.spot === "string" && /^[A-H]$/.test(query.spot) ? query.spot : null;
  const spotLabel = requested && requested.charCodeAt(0) - 65 < count ? requested : count === 1 ? "A" : "B";
  const chosenIndex = spotLabel.charCodeAt(0) - 65;
  return {
    vehicle: { ...VEHICLES[colour], license_plate: "DEMO 123" },
    spotLabel,
    chosenIndex,
    spotStates: Array.from({ length: count }, (_, i) => i === chosenIndex),
  };
}

// Sample-only previews may run on the isolated BetterQA site as well as
// Vercel previews. The real production project remains excluded.
export function isEmailPreviewEnvironment(env = process.env) {
  return env.VERCEL_ENV === "preview" || (
    ["https://biydlfekindgaslgktsx.supabase.co", "https://heqxirlsorcztsawaldg.supabase.co"].includes(env.SUPABASE_URL) &&
    env.APP_URL?.replace(/\/$/, "") === "https://parkshare-qa.vercel.app" &&
    (!env.VERCEL_PROJECT_ID || env.VERCEL_PROJECT_ID === "prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC")
  );
}
