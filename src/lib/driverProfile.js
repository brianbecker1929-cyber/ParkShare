import { VEHICLE_COLOURS, VEHICLE_MODELS } from "./vehicleOptions.js";

const PHONE_DIGIT_MINIMUM = 10;

export function parseLegacyVehicleDetails(value = "") {
  const original = String(value || "").trim();
  if (!original) return { vehicleMake: "", vehicleModel: "", vehicleColour: "" };

  const colour = VEHICLE_COLOURS.find(option =>
    option !== "Other" && original.toLowerCase().startsWith(`${option.toLowerCase()} `)
  ) || "";
  const withoutColour = colour ? original.slice(colour.length).trim() : original;
  const make = Object.keys(VEHICLE_MODELS)
    .filter(option => option !== "Other")
    .sort((a, b) => b.length - a.length)
    .find(option => withoutColour.toLowerCase().startsWith(`${option.toLowerCase()} `)) || "";
  const modelText = make ? withoutColour.slice(make.length).trim() : "";
  const model = make
    ? VEHICLE_MODELS[make].find(option => option.toLowerCase() === modelText.toLowerCase()) || ""
    : "";

  // Only migrate when all three values map cleanly. Unrecognised historic
  // descriptions remain intact instead of being silently reduced to a
  // partial dropdown selection.
  return make && model && colour
    ? { vehicleMake: make, vehicleModel: model, vehicleColour: colour }
    : { vehicleMake: "", vehicleModel: "", vehicleColour: "" };
}

export function formatVehicleDetails(profile = {}) {
  return [profile.vehicleColour, profile.vehicleMake, profile.vehicleModel]
    .map(value => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

export function normaliseDriverProfile(profile = {}) {
  const legacyDetails = String(profile.vehicleDetails || profile.vehicle_details || "").trim();
  const migrated = parseLegacyVehicleDetails(legacyDetails);
  const vehicleMake = String(profile.vehicleMake || profile.vehicle_make || migrated.vehicleMake || "").trim();
  const vehicleModel = String(profile.vehicleModel || profile.vehicle_model || migrated.vehicleModel || "").trim();
  const vehicleColour = String(profile.vehicleColour || profile.vehicle_colour || migrated.vehicleColour || "").trim();
  const structuredDetails = formatVehicleDetails({ vehicleMake, vehicleModel, vehicleColour });

  return {
    name: String(profile.name || "").trim(),
    phone: String(profile.phone || "").trim(),
    vehicleMake,
    vehicleModel,
    vehicleColour,
    vehicleDetails: structuredDetails || legacyDetails,
  };
}

export function getDriverProfileCompletion(profile = {}) {
  const normalised = normaliseDriverProfile(profile);
  const hasStructuredVehicle = Boolean(normalised.vehicleMake || normalised.vehicleModel || normalised.vehicleColour);
  const items = [
    { id: "name", label: "Full name", complete: normalised.name.length >= 2 },
    { id: "phone", label: "Phone number", complete: normalised.phone.replace(/\D/g, "").length >= PHONE_DIGIT_MINIMUM },
    {
      id: "vehicleDetails",
      label: "Vehicle details",
      complete: hasStructuredVehicle
        ? Boolean(normalised.vehicleMake && normalised.vehicleModel && normalised.vehicleColour)
        : normalised.vehicleDetails.length >= 3,
    },
  ];
  const completed = items.filter(item => item.complete).length;

  return {
    items,
    completed,
    total: items.length,
    percentage: Math.round((completed / items.length) * 100),
    complete: completed === items.length,
  };
}

export function validateDriverProfile(profile = {}) {
  const normalised = normaliseDriverProfile(profile);
  const errors = {};

  if (normalised.name.length < 2) errors.name = "Enter your full name.";
  if (normalised.name.length > 80) errors.name = "Keep your name under 80 characters.";

  if (normalised.phone && normalised.phone.replace(/\D/g, "").length < PHONE_DIGIT_MINIMUM) {
    errors.phone = "Enter a complete phone number, including area code.";
  }
  if (normalised.phone.length > 30) errors.phone = "Keep your phone number under 30 characters.";

  const hasStructuredVehicle = Boolean(normalised.vehicleMake || normalised.vehicleModel || normalised.vehicleColour);
  if (hasStructuredVehicle) {
    if (!VEHICLE_MODELS[normalised.vehicleMake]) errors.vehicleMake = "Select your vehicle make.";
    if (!normalised.vehicleModel) errors.vehicleModel = "Select your vehicle model.";
    if (VEHICLE_MODELS[normalised.vehicleMake] && !VEHICLE_MODELS[normalised.vehicleMake].includes(normalised.vehicleModel)) {
      errors.vehicleModel = "Select a model for the chosen make.";
    }
    if (!VEHICLE_COLOURS.includes(normalised.vehicleColour)) errors.vehicleColour = "Select your vehicle colour.";
  }
  if (normalised.vehicleDetails.length > 120) errors.vehicleDetails = "Keep vehicle details under 120 characters.";

  return { normalised, errors, valid: Object.keys(errors).length === 0 };
}
