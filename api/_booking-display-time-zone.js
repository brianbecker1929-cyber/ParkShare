function validTimeZone(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { new Intl.DateTimeFormat('en-CA', {timeZone:value}).format(0); return value; }
  catch { return null; }
}

// A saved booking snapshot takes precedence over today's listing metadata.
// Legacy rows may use the listing's server-verified zone for presentation.
// Never rewrite booking instants, payment dates or persisted history here.
export function bookingDisplayTimeZone(booking, listing) {
  return validTimeZone(booking?.property_time_zone) || validTimeZone(listing?.time_zone);
}
