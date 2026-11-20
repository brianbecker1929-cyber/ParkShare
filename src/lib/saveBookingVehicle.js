import {validateBookingVehicle,bookingVehicleMetadata} from './bookingVehicle.js';

export async function saveBookingVehicle({client,fetcher=fetch,vehicle,accountId,isCurrent}) {
  const validation = validateBookingVehicle(vehicle);
  if (!validation.valid) throw new Error('Complete all four vehicle fields.');
  const body = JSON.stringify(validation.vehicle);
  const currentSession = async () => {
    const {data,error} = await client.auth.getSession();
    if (!isCurrent()) return null;
    if (error || !data?.session?.access_token || data.session.user?.id !== accountId) throw new Error('Your account changed or expired. Sign in again before saving a vehicle.');
    return data.session;
  };
  const session = await currentSession();
  if (!session || !isCurrent()) return null;
  const response = await fetcher('/api/booking-vehicle',{method:'PATCH',cache:'no-store',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body});
  if (!isCurrent()) return null;
  const payload = await response.json().catch(()=>({}));
  if (!isCurrent()) return null;
  if (!response.ok) {
    const error = new Error(payload.error || 'Unable to save your vehicle. Please try again.');
    if (payload.errors && typeof payload.errors==='object' && !Array.isArray(payload.errors)) error.fieldErrors=payload.errors;
    throw error;
  }
  const saved = validateBookingVehicle(payload.vehicle);
  if (!payload.vehicle || !saved.valid) throw new Error('Could not confirm your saved vehicle. Please try again.');
  try {
    if (!await currentSession() || !isCurrent()) return null;
    const {data,error} = await client.auth.refreshSession();
    if (!isCurrent()) return null;
    if (error || !data?.session?.access_token || data.session.user?.id!==accountId) throw new Error('Session changed');
    const metadata = data.session.user.user_metadata || {};
    if (!Object.entries(bookingVehicleMetadata(saved.vehicle)).every(([key,value])=>metadata[key]===value)) throw new Error('Vehicle metadata not refreshed');
    if (!await currentSession() || !isCurrent()) return null;
  } catch {
    if (!isCurrent()) return null;
    throw new Error('Your vehicle was saved, but your session could not be confirmed. Sign in again to check the saved details.');
  }
  return saved.vehicle;
}
