import { jsonMethod, requireUser, supabaseAdmin } from "./_lib.js";
import { getDriverProfileCompletion, validateDriverProfile } from "../src/lib/driverProfile.js";

// PATCH /api/profile
// Updates the signed-in user's private Driver details in Supabase Auth metadata
// and keeps the public display name in profiles synchronized.
export default async function handler(req, res) {
  if (!jsonMethod(req, res, "PATCH")) return;

  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const { normalised, errors, valid } = validateDriverProfile(req.body || {});
    if (!valid) return res.status(400).json({ error: "Check the highlighted fields.", errors });

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ name: normalised.name })
      .eq("id", user.id);
    if (profileError) throw profileError;

    const completion = getDriverProfileCompletion(normalised);
    const metadata = {
      ...(user.user_metadata || {}),
      name: normalised.name,
      phone: normalised.phone,
      vehicle_details: normalised.vehicleDetails,
      vehicle_make: normalised.vehicleMake,
      vehicle_model: normalised.vehicleModel,
      vehicle_colour: normalised.vehicleColour,
      license_plate: normalised.licensePlate,
      guest_vehicles: normalised.guestVehicles,
      profile_completed_at: completion.complete
        ? user.user_metadata?.profile_completed_at || new Date().toISOString()
        : null,
    };
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: metadata,
    });
    if (authError) throw authError;

    return res.status(200).json({
      profile: {
        name: normalised.name,
        phone: normalised.phone,
        vehicleDetails: normalised.vehicleDetails,
        vehicleMake: normalised.vehicleMake,
        vehicleModel: normalised.vehicleModel,
        vehicleColour: normalised.vehicleColour,
        licensePlate: normalised.licensePlate,
        guestVehicles: normalised.guestVehicles,
      },
      completion,
    });
  } catch (error) {
    console.error("profile update error:", error);
    return res.status(500).json({ error: "Unable to save your profile right now. Please try again." });
  }
}
