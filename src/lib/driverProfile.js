import { VEHICLE_COLOURS, VEHICLE_MODELS } from "./vehicleOptions.js";

const PHONE_DIGIT_MINIMUM = 10;
export const MAX_GUEST_VEHICLES = 5;

function vehicleFields(vehicle = {}) {
  return {
    vehicleMake: String(vehicle.vehicleMake || vehicle.vehicle_make || "").trim(),
    vehicleModel: String(vehicle.vehicleModel || vehicle.vehicle_model || "").trim(),
    vehicleColour: String(vehicle.vehicleColour || vehicle.vehicle_colour || "").trim(),
    licensePlate: String(vehicle.licensePlate || vehicle.license_plate || "").trim().toUpperCase(),
  };
}

function guestVehicleArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normaliseGuestVehicles(value = []) {
  return guestVehicleArray(value)
    .slice(0, MAX_GUEST_VEHICLES)
    .map((vehicle, index) => ({
      id: String(vehicle?.id || `guest-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || `guest-${index + 1}`,
      ...vehicleFields(vehicle),
    }))
    .filter(vehicle => vehicle.vehicleMake || vehicle.vehicleModel || vehicle.vehicleColour || vehicle.licensePlate);
}

export function isVehicleComplete(vehicle = {}) {
  const normalised = vehicleFields(vehicle);
  return Boolean(normalised.vehicleMake && normalised.vehicleModel && normalised.vehicleColour && normalised.licensePlate);
}

export function formatVehicleLabel(vehicle = {}) {
  const normalised = vehicleFields(vehicle);
  const description = [normalised.vehicleColour, normalised.vehicleMake, normalised.vehicleModel].filter(Boolean).join(" ");
  return [description, normalised.licensePlate].filter(Boolean).join(" · ");
}

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
  const licensePlate = String(profile.licensePlate || profile.license_plate || "").trim().toUpperCase();
  const structuredDetails = formatVehicleDetails({ vehicleMake, vehicleModel, vehicleColour });
  const guestVehicles = normaliseGuestVehicles(profile.guestVehicles || profile.guest_vehicles || []);

  return {
    name: String(profile.name || "").trim(),
    phone: String(profile.phone || "").trim(),
    vehicleMake,
    vehicleModel,
    vehicleColour,
    licensePlate,
    guestVehicles,
    vehicleDetails: structuredDetails || legacyDetails,
  };
}

export function getBookableVehicles(profile = {}) {
  const normalised = normaliseDriverProfile(profile);
  const primary = {
    id: "primary",
    type: "primary",
    label: "Primary vehicle",
    vehicleMake: normalised.vehicleMake,
    vehicleModel: normalised.vehicleModel,
    vehicleColour: normalised.vehicleColour,
    licensePlate: normalised.licensePlate,
  };
  const guests = normalised.guestVehicles.map((vehicle, index) => ({
    ...vehicle,
    type: "guest",
    label: `Guest vehicle ${index + 1}`,
  }));
  return [primary, ...guests].filter(isVehicleComplete);
}

export function getDriverProfileCompletion(profile = {}) {
  const normalised = normaliseDriverProfile(profile);
  const hasStructuredVehicle = Boolean(normalised.vehicleMake || normalised.vehicleModel || normalised.vehicleColour || normalised.licensePlate);
  const items = [
    { id: "name", label: "Full name", complete: normalised.name.length >= 2 },
    { id: "phone", label: "Phone number", complete: normalised.phone.replace(/\D/g, "").length >= PHONE_DIGIT_MINIMUM },
    {
      id: "vehicleDetails",
      label: "Vehicle details",
      complete: hasStructuredVehicle
        ? Boolean(normalised.vehicleMake && normalised.vehicleModel && normalised.vehicleColour && normalised.licensePlate)
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

  const hasStructuredVehicle = Boolean(normalised.vehicleMake || normalised.vehicleModel || normalised.vehicleColour || normalised.licensePlate);
  if (hasStructuredVehicle) {
    if (!VEHICLE_MODELS[normalised.vehicleMake]) errors.vehicleMake = "Select your vehicle make.";
    if (!normalised.vehicleModel) errors.vehicleModel = "Select your vehicle model.";
    if (VEHICLE_MODELS[normalised.vehicleMake] && !VEHICLE_MODELS[normalised.vehicleMake].includes(normalised.vehicleModel)) {
      errors.vehicleModel = "Select a model for the chosen make.";
    }
    if (!VEHICLE_COLOURS.includes(normalised.vehicleColour)) errors.vehicleColour = "Select your vehicle colour.";
  }
  if (normalised.licensePlate && !/^[A-Z0-9 -]{2,15}$/.test(normalised.licensePlate)) {
    errors.licensePlate = "Enter a valid license plate number using letters and numbers.";
  }
  if (normalised.vehicleDetails.length > 120) errors.vehicleDetails = "Keep vehicle details under 120 characters.";

  const rawGuests = guestVehicleArray(profile.guestVehicles || profile.guest_vehicles || []);
  if (rawGuests.length > MAX_GUEST_VEHICLES) errors.guestVehicles = `Save up to ${MAX_GUEST_VEHICLES} guest vehicles.`;
  rawGuests.slice(0, MAX_GUEST_VEHICLES).forEach((rawVehicle, index) => {
    const vehicle = vehicleFields(rawVehicle);
    if (!vehicle.vehicleMake && !vehicle.vehicleModel && !vehicle.vehicleColour && !vehicle.licensePlate) return;
    const prefix = `guestVehicles.${index}`;
    if (!VEHICLE_MODELS[vehicle.vehicleMake]) errors[`${prefix}.vehicleMake`] = "Select the guest vehicle make.";
    if (!vehicle.vehicleModel) errors[`${prefix}.vehicleModel`] = "Select the guest vehicle model.";
    if (VEHICLE_MODELS[vehicle.vehicleMake] && !VEHICLE_MODELS[vehicle.vehicleMake].includes(vehicle.vehicleModel)) {
      errors[`${prefix}.vehicleModel`] = "Select a model for the chosen make.";
    }
    if (!VEHICLE_COLOURS.includes(vehicle.vehicleColour)) errors[`${prefix}.vehicleColour`] = "Select the guest vehicle colour.";
    if (!/^[A-Z0-9 -]{2,15}$/.test(vehicle.licensePlate)) {
      errors[`${prefix}.licensePlate`] = "Enter a valid guest license plate number.";
    }
  });

  return { normalised, errors, valid: Object.keys(errors).length === 0 };
}
