// Coordinates are numbers from an explicit address suggestion/map pin, never
// null/empty values silently coerced to the Gulf of Guinea.
export function hasListingCoordinates(point) {
  return typeof point?.lat === 'number' && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && typeof point?.lng === 'number' && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}
export function changeListingAddress(form, field, value) {
  if (form[field] === value) return form;
  // Formatting a postal code on blur doesn't move the property.
  const samePostal = field === 'postal' && String(form.postal || '').replace(/\s/g,'').toUpperCase() === String(value).replace(/\s/g,'').toUpperCase();
  return samePostal ? {...form,[field]:value} : {...form,[field]:value,lat:null,lng:null,spots:[]};
}
