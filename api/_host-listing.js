import {validateHourlyRate,NEW_LISTING_MAX_HOURLY_RATE_CAD} from '../src/lib/listingPrice.js';
import {validateCanadianPostalCode} from '../src/lib/canadianPostalCode.js';
import {normalizeAvailability,hasAnyAvailability} from '../src/lib/listingAvailability.js';
import {validateHostAvailabilityExceptions} from '../src/lib/availabilityExceptionDates.js';
import {MAX_LISTING_PHOTOS} from '../src/lib/listingPhotos.js';
const FEATURES = new Set(['Covered','CCTV','Well-lit','Snow removal','EV charging','Gated']);
const fail = message => { throw new RangeError(message); };
export function hostListingRow(body, hostId, timeZone, supabaseUrl, now = new Date()) {
  const rate = validateHourlyRate(body?.price,{maxRate:NEW_LISTING_MAX_HOURLY_RATE_CAD});
  if(!rate.valid) fail(rate.error);
  const address = typeof body?.address === 'string' ? body.address.trim() : '';
  if (!address || address.length > 500 || !validateCanadianPostalCode(address.slice(-7)).valid) fail('Complete the driveway address with a valid Canadian postal code before publishing.');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if(!title || title.length>200) fail('Enter a driveway title of at most 200 characters.');
  if(typeof body.description !== 'string' || body.description.length>5000) fail('Enter a description of at most 5,000 characters.');
  if(!Array.isArray(body.features) || body.features.some(f=>!FEATURES.has(f)) || body.features.length>FEATURES.size) fail('Choose valid driveway features.');
  const prefix = new URL('/storage/v1/object/public/listing-photos/',supabaseUrl).href;
  const photos = body.photos;
  if(!Array.isArray(photos) || photos.length<1 || photos.length>MAX_LISTING_PHOTOS || photos.some(url=>{
    if(typeof url!=='string' || !url.startsWith(prefix+hostId+'/'))return true;
    return !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|png|webp)$/i.test(url.slice((prefix+hostId+'/').length));
  }))fail('Upload between one and six driveway photos to your Host account.');
  if(!Array.isArray(body.spots) || body.spots.length<1 || body.spots.length>8)fail('Mark between one and eight parking spaces.');
  const spots=body.spots.map((spot,index)=>{
    if(typeof spot?.forRent!=='boolean')fail('Mark each space as available or private.');
    let bounds=null;
    if(spot.bounds!=null){
      bounds={};for(const key of ['north','south','east','west']){
        const v=spot.bounds[key];if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>(['north','south'].includes(key)?90:180))fail('Redraw the parking spaces at the confirmed driveway location.');bounds[key]=v;
      }
      if(bounds.north<=bounds.south || bounds.east<=bounds.west || ['north','south'].some(k=>Math.abs(bounds[k]-body.lat)>0.01) || ['east','west'].some(k=>Math.abs(bounds[k]-body.lng)>0.01))fail('Redraw the parking spaces at the confirmed driveway location.');
    }
    return {id:String(index),forRent:spot.forRent,bounds};
  });
  const spaces=spots.filter(s=>s.forRent).length;
  if(!spaces)fail('Mark at least one parking space as available.');
  if(!body.availability || JSON.stringify(body.availability).length>32000)fail('Choose a valid availability schedule.');
  // Weekly hours and date exceptions belong to the property, not the Host's
  // current browser timezone. Never accept a client-supplied timezone override.
  const days = ['sun','mon','tue','wed','thu','fri','sat'];
  const validWindows = windows => Array.isArray(windows) && windows.length <= 8 && windows.every(window =>
    /^([01]\d|2[0-3]):[0-5]\d$/.test(window?.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(window?.end) && window.start < window.end);
  if(days.some(day=>typeof body.availability.weekly?.[day]?.enabled !== 'boolean' || !validWindows(body.availability.weekly[day].windows))
    || !Array.isArray(body.availability.exceptions) || body.availability.exceptions.length > 100
    || body.availability.exceptions.some(exception=>!['unavailable','available-all-day','custom'].includes(exception?.type)
      || (exception.type==='custom' && !validWindows(exception.windows)))) fail('Choose valid availability hours and special dates.');
  // Validate raw dates before normalization can discard malformed entries.
  const dates=validateHostAvailabilityExceptions({...body.availability,timezone:timeZone},now);
  if(!dates.valid)fail(dates.issues[0].error);
  const availability=normalizeAvailability({...body.availability,timezone:timeZone});
  if(!hasAnyAvailability(availability))fail('Make at least one time available.');
  return {host_id:hostId,title,address,price:rate.value,description:body.description,features:[...new Set(body.features)],spaces,
    photos,img:photos[0],spots,availability,lat:body.lat,lng:body.lng,time_zone:timeZone};
}
