// PATCH /api/booking-vehicle — save the caller's primary booking vehicle.
// Both Hosts and Drivers can park. Driver /profile access remains separate.
import {jsonMethod,requireUser,supabaseAdmin} from './_lib.js';
import {validateBookingVehicle,bookingVehicleMetadata} from '../src/lib/bookingVehicle.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (!jsonMethod(req,res,'PATCH')) return;
  try {
    const user = await requireUser(req,res);
    if (!user) return;
    const {data:profile,error:roleError} = await supabaseAdmin.from('profiles').select('role').eq('id',user.id).maybeSingle();
    if (roleError) throw roleError;
    if (!['host','driver'].includes(profile?.role)) return res.status(403).json({error:'A ParkShare account is required to save a booking vehicle.'});
    const {vehicle,errors,valid} = validateBookingVehicle(req.body);
    if (!valid) return res.status(400).json({error:'Complete the highlighted vehicle fields.',errors});
    // Auth merges only this allowlist. Never replay a stale metadata snapshot
    // or accept a user ID, role, name or guest-vehicle list from the request.
    const {data,error} = await supabaseAdmin.auth.admin.updateUserById(user.id,{user_metadata:bookingVehicleMetadata(vehicle)});
    if (error) throw error;
    if (data?.user?.id !== user.id) throw new Error('Vehicle save was not confirmed');
    return res.status(200).json({vehicle});
  } catch {
    return res.status(500).json({error:'Unable to confirm your saved vehicle. Please try again.'});
  }
}
