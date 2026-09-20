const OPENTABLE_WIDGET_BASE = "https://www.opentable.ca/widget/reservation/canvas";

export const OPENTABLE_BRAND_RED = "#DA3743";

function normalizeLookupValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseOpenTableRestaurantMap(rawMap) {
  if (!rawMap) return {};
  if (typeof rawMap === "object" && !Array.isArray(rawMap)) return rawMap;

  try {
    const parsed = JSON.parse(String(rawMap));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveOpenTableRestaurantId(restaurant, rawMap) {
  if (!restaurant) return null;

  const directRid = String(restaurant.openTableRid || restaurant.opentableRid || "").trim();
  if (/^\d+$/.test(directRid)) return directRid;

  const map = parseOpenTableRestaurantMap(rawMap);
  const normalizedMap = new Map(
    Object.entries(map).map(([key, value]) => [normalizeLookupValue(key), String(value || "").trim()]),
  );

  const name = normalizeLookupValue(restaurant.name);
  const address = normalizeLookupValue(restaurant.address);
  const candidates = [
    String(restaurant.id || "").trim(),
    name && address ? `${name}|${address}` : "",
    name,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const exact = map[candidate];
    if (/^\d+$/.test(String(exact || "").trim())) return String(exact).trim();

    const normalized = normalizedMap.get(normalizeLookupValue(candidate));
    if (/^\d+$/.test(String(normalized || "").trim())) return String(normalized).trim();
  }

  return null;
}

export function buildOpenTableWidgetUrl(rid) {
  const safeRid = String(rid || "").trim();
  if (!/^\d+$/.test(safeRid)) return "";

  const params = new URLSearchParams({
    rid: safeRid,
    domain: "ca",
    type: "standard",
    theme: "standard",
    color: "1",
    dark: "false",
    lang: "en-CA",
    newtab: "false",
    overlay: "false",
    iframe: "true",
    ot_source: "ParkShare",
  });

  return `${OPENTABLE_WIDGET_BASE}?${params.toString()}`;
}
