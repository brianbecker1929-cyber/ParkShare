import {normalizeAvailability,hasAnyAvailability,AVAILABILITY_DAYS} from './listingAvailability.js';
import {dateInScheduleTimezone,validateHostAvailabilityExceptions} from './availabilityExceptionDates.js';
export const LISTING_FEATURE_OPTIONS = ['Covered','CCTV','Well-lit','Snow removal','EV charging','Gated'];
export function verifiedScheduleZone(zone) {
  if (typeof zone !== 'string' || !zone.trim()) return false;
  try {new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(); return true;} catch {return false;}
}
export function editableListingAvailability(value, zone, now = new Date()) {
  if (!verifiedScheduleZone(zone)) return null;
  const availability = normalizeAvailability(value), today = dateInScheduleTimezone(zone, now);
  return {...availability,timezone:zone,exceptions:availability.exceptions
    .filter(item=>item.endDate >= today).map(item=>({...item,startDate:item.startDate < today ? today : item.startDate}))};
}
export function listingScheduleError(input, zone, paused = false, now = new Date()) {
  if (!verifiedScheduleZone(zone)) return 'The property time zone must be verified before changing its schedule.';
  if (!input || typeof input !== 'object' || JSON.stringify(input).length > 32_000) return 'Choose a valid availability schedule.';
  if (input.timezone !== zone) return 'Schedule times must use the verified property time zone.';
  const validTime=value=>typeof value==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const windows=value=>Array.isArray(value)&&value.length<=8&&value.every(w=>validTime(w?.start)&&validTime(w?.end)&&w.start<w.end);
  if (AVAILABILITY_DAYS.some(({key})=>typeof input.weekly?.[key]?.enabled!=='boolean'||!windows(input.weekly[key].windows)
    || input.weekly[key].enabled && !input.weekly[key].windows.length)) return 'Each open day needs valid hours with an end after its start.';
  if (!Array.isArray(input.exceptions)||input.exceptions.length>100||input.exceptions.some(e=>!['unavailable','available-all-day','custom'].includes(e?.type)||e.type==='custom'&&(!windows(e.windows)||!e.windows.length))) return 'Choose valid special dates and hours.';
  const dates=validateHostAvailabilityExceptions({...input,timezone:zone},now);
  if(!dates.valid)return dates.issues[0].error;
  if(!paused&&!hasAnyAvailability(input))return 'Make at least one time available before resuming this listing.';
  return '';
}
