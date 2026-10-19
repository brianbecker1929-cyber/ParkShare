import {find} from 'geo-tz/all';
import {hasListingCoordinates} from '../src/lib/listingLocation.js';
export function resolveListingTimeZone(point, lookup = find) {
  if (!hasListingCoordinates(point)) throw new RangeError('Select your driveway from the address suggestions and confirm its map pin before publishing.');
  const zones = lookup(point.lat, point.lng);
  if (!Array.isArray(zones) || zones.length !== 1 || typeof zones[0] !== 'string' || /^(Etc\/|UTC$)/.test(zones[0])) {
    throw new RangeError('We could not determine one property time zone for this pin. Adjust the pin onto your driveway or contact support.');
  }
  new Intl.DateTimeFormat('en-CA',{timeZone:zones[0]}).format(new Date());
  return zones[0];
}
