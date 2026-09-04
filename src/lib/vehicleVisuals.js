const BODY_MODEL_GROUPS = {
  pickup: [
    "Avalanche", "Colorado", "Silverado 1500", "Silverado 2500HD", "Silverado 3500HD",
    "Dakota", "Ram 1500", "F-150", "F-250", "F-350", "Maverick", "Ranger",
    "Canyon", "Sierra 1500", "Sierra 2500HD", "Sierra 3500HD", "Ridgeline",
    "Santa Cruz", "Gladiator", "Frontier", "Titan", "1500", "2500", "3500",
    "R1T", "Equator", "Cybertruck", "Tacoma", "Tundra",
  ],
  van: [
    "Express", "Uplander", "Grand Caravan", "Pacifica", "Town & Country", "Voyager",
    "Caravan", "E-Series", "Transit", "Transit Connect", "Savana", "Odyssey", "Entourage",
    "Carnival", "Sedona", "Sprinter", "NV", "ProMaster", "ProMaster City", "Sienna",
    "ID. Buzz", "Monterey", "Montana", "Relay", "Rondo", "Mazda5", "Silhouette",
  ],
  suv: [
    "MDX", "RDX", "ZDX", "Stelvio", "Tonale", "Bentayga", "iX", "Enclave", "Encore",
    "Encore GX", "Envision", "Envista", "Escalade", "LYRIQ", "OPTIQ", "SRX", "Blazer",
    "Captiva", "Equinox", "Suburban", "Tahoe", "Trailblazer", "Traverse", "Trax", "Aspen",
    "Durango", "Hornet", "Journey", "Purosangue", "Bronco", "Bronco Sport", "EcoSport", "Edge",
    "Escape", "Expedition", "Explorer", "Mustang Mach-E", "Acadia", "Envoy", "Hummer EV",
    "Terrain", "Yukon", "CR-V", "Crosstour", "Element", "HR-V", "Passport", "Pilot",
    "Prologue", "H1", "H2", "H3", "Ioniq 5", "Kona", "Nexo", "Palisade", "Santa Fe",
    "Tucson", "Venue", "Veracruz", "E-PACE", "F-PACE", "I-PACE", "Cherokee", "Commander",
    "Compass", "Grand Cherokee", "Grand Wagoneer", "Liberty", "Patriot", "Renegade", "Wagoneer",
    "Wrangler", "Borrego", "EV6", "EV9", "Niro", "Seltos", "Sorento", "Soul", "Sportage",
    "Telluride", "Urus", "Defender", "Discovery", "Discovery Sport", "Freelander", "Range Rover",
    "Range Rover Evoque", "Range Rover Sport", "Range Rover Velar", "Aviator", "Corsair", "Nautilus",
    "Navigator", "Gravity", "Grecale", "Levante", "Endeavor", "Eclipse Cross", "Montero", "Outlander",
    "Outlander PHEV", "RVR", "ARIYA", "Armada", "Juke", "Kicks", "Murano", "Pathfinder", "Qashqai",
    "Rogue", "Xterra", "Bravada", "Cayenne", "Macan", "R1S", "9-7X", "Outlook", "VUE", "Ascent",
    "B9 Tribeca", "Crosstrek", "Forester", "Outback", "Solterra", "Tribeca", "XV Crosstrek",
    "Grand Vitara", "Vitara", "XL7", "Model X", "Model Y", "4Runner", "bZ4X", "C-HR",
    "Corolla Cross", "FJ Cruiser", "Grand Highlander", "Highlander", "Land Cruiser", "RAV4",
    "Sequoia", "Venza", "Atlas", "Atlas Cross Sport", "ID.4", "Taos", "Tiguan", "Touareg",
    "C40 Recharge", "EX30", "EX40", "EX90", "XC40", "XC60", "XC70", "XC90",
    "Bolt EUV", "Orlando", "Nitro", "500X", "Flex", "EX", "FX", "JX",
    "CX-3", "CX-30", "CX-5", "CX-50", "CX-7", "CX-70", "CX-9", "CX-90",
    "MX-30", "Tribute", "G-Class", "GL", "GLK", "M-Class", "Mariner", "Mountaineer",
    "Countryman", "Paceman", "Aztek", "Torrent",
  ],
  coupe: [
    "4C", "R8", "TT", "Continental GT", "i8", "Cascada", "ELR", "Camaro", "Corvette",
    "Monte Carlo", "Crossfire", "Challenger", "Viper", "296", "458", "488", "812", "California",
    "F8", "Portofino", "Roma", "SF90", "124 Spider", "Mustang", "S2000", "Tiburon", "Veloster",
    "F-TYPE", "XK", "Aventador", "Gallardo", "Huracan", "Revuelto", "LC", "LFA", "RC", "SC",
    "GranCabrio", "GranTurismo", "MC20", "MX-5 Miata", "RX-8", "AMG GT", "CLE", "CLK", "SL",
    "SLC", "SLK", "Convertible", "Coupe", "Roadster", "350Z", "370Z", "GT-R", "Z", "Solstice",
    "718 Boxster", "718 Cayman", "911", "BRZ", "FR-S", "tC", "Sky", "GR86", "Supra",
    "CL", "NSX", "RSX", "CR-Z", "Prelude", "Eclipse", "Celica", "Solara", "Eos", "Z4",
  ],
  hatchback: [
    "Aveo", "Bolt EV", "HHR", "Sonic", "Spark", "Caliber", "500", "500e", "C-Max", "Fiesta",
    "Focus", "Fit", "Insight", "Accent", "Ioniq", "LEAF", "Micra", "Versa", "i3", "Clubman",
    "Cooper", "Hardtop", "Mirage", "Cube", "Astra", "iM", "iQ", "xA", "xB", "xD", "fortwo",
    "Impreza", "Swift", "Prius", "Yaris", "Beetle", "Golf", "Golf GTI", "Golf R", "Rabbit", "C30",
    "PT Cruiser", "GTC4Lusso", "500L", "Q30", "9-2X", "SX4", "Vibe", "Matrix",
  ],
};

const COLOUR_HEX = {
  Black: "#24272C", White: "#F7F5EE", Silver: "#BFC5CA", Grey: "#777E86",
  Blue: "#1769AA", Red: "#D93632", Green: "#3F7A5E", Brown: "#795548",
  Beige: "#D7C5A0", Gold: "#C99A18", Yellow: "#FFC107", Orange: "#E87524",
  Purple: "#7451A6", Burgundy: "#7B2431", Other: "#87939C",
};

const VEHICLE_ASSET_ROOT = "/vehicles";

export function getVehicleBodyType(vehicle = {}) {
  const model = String(vehicle.vehicleModel || vehicle.vehicle_model || "").trim();
  const make = String(vehicle.vehicleMake || vehicle.vehicle_make || "").trim();

  for (const [bodyType, models] of Object.entries(BODY_MODEL_GROUPS)) {
    if (models.includes(model)) return bodyType;
  }

  if (make === "Polestar" && /^(3|4)$/.test(model)) return "suv";
  if (/^(Q[3-8]|X[1-7]|GL[A-S]|EQ[AB]|GV\d|GX|LX|NX|RX|RZ|TX|UX|QX\d|XT\d)$/.test(model)) return "suv";
  if (make === "Jeep" || make === "Hummer" || make === "Land Rover") return "suv";
  return "sedan";
}

export function getVehicleColourHex(vehicle = {}) {
  return COLOUR_HEX[getVehicleColourName(vehicle)];
}

export function getVehicleColourName(vehicle = {}) {
  const colour = String(vehicle.vehicleColour || vehicle.vehicle_colour || "").trim();
  return Object.hasOwn(COLOUR_HEX, colour) ? colour : "Other";
}

export function getVehicleAssetPath(vehicle = {}) {
  return `${VEHICLE_ASSET_ROOT}/vehicle-${getVehicleBodyType(vehicle)}.webp`;
}

export function formatVehicleVisualSummary(vehicle = {}) {
  const make = String(vehicle.vehicleMake || vehicle.vehicle_make || "").trim();
  const model = String(vehicle.vehicleModel || vehicle.vehicle_model || "").trim();
  const colour = String(vehicle.vehicleColour || vehicle.vehicle_colour || "").trim();
  const name = [make, model].filter(Boolean).join(" ");
  return [name, colour].filter(Boolean).join(" · ");
}
