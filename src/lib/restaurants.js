export const RESTAURANT_CUISINES = [
  { value: "", label: "All cuisines" },
  { value: "italian_restaurant", label: "Italian" },
  { value: "pizza_restaurant", label: "Pizza" },
  { value: "japanese_restaurant", label: "Japanese" },
  { value: "chinese_restaurant", label: "Chinese" },
  { value: "indian_restaurant", label: "Indian" },
  { value: "mexican_restaurant", label: "Mexican" },
  { value: "mediterranean_restaurant", label: "Mediterranean" },
  { value: "thai_restaurant", label: "Thai" },
  { value: "vegetarian_restaurant", label: "Vegetarian" },
  { value: "cafe", label: "Cafes" },
];

export function buildRestaurantSearchText(query, cuisine) {
  const cleanQuery = String(query || "").trim();
  const cuisineLabel = cuisine ? RESTAURANT_CUISINES.find(option => option.value === cuisine)?.label || "" : "";
  if (cleanQuery && cuisineLabel) return `${cleanQuery} ${cuisineLabel}`;
  if (cleanQuery) return cleanQuery;
  if (cuisineLabel) return `${cuisineLabel} restaurants`;
  return "restaurants";
}

export function normalizeRestaurantPlace(place) {
  const lat = typeof place?.location?.lat === "function" ? place.location.lat() : place?.location?.lat;
  const lng = typeof place?.location?.lng === "function" ? place.location.lng() : place?.location?.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const typeLabel = typeof place.primaryTypeDisplayName === "string"
    ? place.primaryTypeDisplayName
    : place.primaryTypeDisplayName?.text;

  return {
    id: place.id || `${lat},${lng}`,
    name: place.displayName || "Restaurant",
    address: place.formattedAddress || "Address unavailable",
    cuisine: typeLabel || "Restaurant",
    lat,
    lng,
  };
}

export function chooseRandomRestaurant(restaurants, random = Math.random) {
  const choices = Array.isArray(restaurants) ? restaurants.filter(Boolean) : [];
  if (choices.length === 0) return null;
  const sample = Number(random());
  const safeSample = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 0.999999999) : 0;
  return choices[Math.floor(safeSample * choices.length)];
}
