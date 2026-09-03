const PHONE_DIGIT_MINIMUM = 10;

export function normaliseDriverProfile(profile = {}) {
  return {
    name: String(profile.name || "").trim(),
    phone: String(profile.phone || "").trim(),
    vehicleDetails: String(profile.vehicleDetails || profile.vehicle_details || "").trim(),
  };
}

export function getDriverProfileCompletion(profile = {}) {
  const normalised = normaliseDriverProfile(profile);
  const items = [
    { id: "name", label: "Full name", complete: normalised.name.length >= 2 },
    { id: "phone", label: "Phone number", complete: normalised.phone.replace(/\D/g, "").length >= PHONE_DIGIT_MINIMUM },
    { id: "vehicleDetails", label: "Vehicle details", complete: normalised.vehicleDetails.length >= 3 },
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
  if (normalised.vehicleDetails.length > 120) errors.vehicleDetails = "Keep vehicle details under 120 characters.";

  return { normalised, errors, valid: Object.keys(errors).length === 0 };
}
