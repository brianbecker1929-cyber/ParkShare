const SITE_ORIGIN = "https://www.myparkshare.ca";

const ROUTES = [
  {
    path: "/",
    screen: "landing",
    title: "ParkShare | Find or List Private Parking",
    description: "Find convenient private parking near your destination or earn income by listing your available driveway with ParkShare.",
  },
  {
    path: "/parking",
    screen: "app",
    tab: "Browse",
    title: "Find Private Parking Near You | ParkShare",
    description: "Search and compare private parking spaces near your destination with ParkShare.",
  },
  {
    path: "/discover",
    screen: "app",
    tab: "Discover",
    title: "Discover Restaurants and Events | ParkShare",
    description: "Find restaurants, events and festivals, then search for convenient ParkShare parking nearby.",
  },
  {
    path: "/my-bookings",
    screen: "app",
    tab: "My Bookings",
    title: "My Bookings | ParkShare",
    description: "Review and manage your ParkShare parking reservations.",
    private: true,
  },
  {
    path: "/messages",
    screen: "app",
    tab: "Messages",
    title: "Messages | ParkShare",
    description: "View your ParkShare booking conversations.",
    private: true,
  },
  {
    path: "/profile",
    screen: "app",
    tab: "Profile",
    title: "My Profile | ParkShare",
    description: "Manage your ParkShare profile and vehicle details.",
    private: true,
  },
  {
    path: "/list-your-driveway",
    screen: "app",
    tab: "List Your Driveway",
    title: "List Your Driveway | ParkShare",
    description: "Create and manage a private parking listing with ParkShare.",
    private: true,
  },
  {
    path: "/host-dashboard",
    screen: "app",
    tab: "Host Dashboard",
    title: "Host Dashboard | ParkShare",
    description: "Manage your ParkShare listings, reservations and hosting activity.",
    private: true,
  },
  {
    path: "/transactions",
    screen: "app",
    tab: "Transactions",
    title: "Transactions | ParkShare",
    description: "Review your ParkShare transaction history.",
    private: true,
  },
  {
    path: "/drivers",
    screen: "driver",
    title: "Parking for Drivers | ParkShare",
    description: "Find and reserve convenient private parking near your destination with ParkShare.",
  },
  {
    path: "/hosts",
    screen: "host",
    title: "Rent Out Your Driveway | ParkShare",
    description: "Earn income by listing your available driveway or private parking space on ParkShare.",
  },
  {
    path: "/about",
    screen: "about",
    title: "About ParkShare | Private Parking Marketplace",
    description: "Learn how ParkShare connects drivers with trusted private parking hosts across Canada.",
  },
  {
    path: "/trust-and-safety",
    screen: "trust",
    title: "Trust and Safety | ParkShare",
    description: "Learn how ParkShare helps drivers and hosts enjoy safer, clearer private parking experiences.",
  },
  {
    path: "/help",
    screen: "help",
    title: "Help and FAQ | ParkShare",
    description: "Find answers about ParkShare bookings, hosting, payments, accounts and parking reservations.",
  },
  {
    path: "/contact",
    screen: "contact",
    title: "Contact ParkShare",
    description: "Contact ParkShare for help with parking reservations, hosting, payments or your account.",
  },
  {
    path: "/terms",
    screen: "legal",
    anchor: "terms",
    title: "Terms and Conditions | ParkShare",
    description: "Read the ParkShare terms and conditions for drivers, hosts and visitors.",
  },
  {
    path: "/privacy",
    screen: "legal",
    anchor: "privacy",
    title: "Privacy Policy | ParkShare",
    description: "Read the ParkShare privacy policy and learn how personal information is handled.",
  },
];

const ROUTE_BY_PATH = new Map(ROUTES.map(route => [route.path, route]));
const ROUTE_BY_TAB = new Map(ROUTES.filter(route => route.tab).map(route => [route.tab, route]));
const ROUTE_BY_SCREEN = new Map(ROUTES.filter(route => !route.tab && route.screen !== "legal").map(route => [route.screen, route]));

export function normalizePathname(pathname = "/") {
  const clean = `/${String(pathname || "").split("?")[0].split("#")[0].replace(/^\/+|\/+$/g, "")}`;
  return clean === "/" ? clean : clean.toLowerCase();
}

export function getRouteFromPath(pathname = "/") {
  const normalizedPath = normalizePathname(pathname);
  return ROUTE_BY_PATH.get(normalizedPath) || ROUTE_BY_PATH.get("/");
}

export function getRouteForState(screen, tab = "Browse", anchor = null) {
  if (screen === "legal") return ROUTE_BY_PATH.get(anchor === "privacy" ? "/privacy" : "/terms");
  if (screen === "app") return ROUTE_BY_TAB.get(tab) || ROUTE_BY_PATH.get("/parking");
  return ROUTE_BY_SCREEN.get(screen) || ROUTE_BY_PATH.get("/");
}

function ensureMeta(selector, attributes) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    document.head.appendChild(element);
  }
  return element;
}

export function updateRouteMetadata(route) {
  if (typeof document === "undefined") return;
  const activeRoute = route || ROUTE_BY_PATH.get("/");
  const canonicalUrl = `${SITE_ORIGIN}${activeRoute.path}`;

  document.title = activeRoute.title;
  ensureMeta('meta[name="description"]', { name: "description" }).setAttribute("content", activeRoute.description);
  ensureMeta('meta[name="robots"]', { name: "robots" }).setAttribute("content", activeRoute.private ? "noindex, nofollow" : "index, follow");
  ensureMeta('meta[property="og:title"]', { property: "og:title" }).setAttribute("content", activeRoute.title);
  ensureMeta('meta[property="og:description"]', { property: "og:description" }).setAttribute("content", activeRoute.description);
  ensureMeta('meta[property="og:url"]', { property: "og:url" }).setAttribute("content", canonicalUrl);

  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", canonicalUrl);
}

export const PARKSHARE_ROUTES = ROUTES;
