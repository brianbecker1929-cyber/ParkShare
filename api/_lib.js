import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Log exactly which server env vars are missing at cold start — this shows
// up in Vercel's Function Logs immediately, before any request even comes
// in, so a misconfigured deployment is obvious without having to reproduce
// a 401 first. Never logs the actual secret values, only whether each is set.
const envStatus = {
  STRIPE_SECRET_KEY: Boolean(process.env.STRIPE_SECRET_KEY),
  SUPABASE_URL: Boolean(supabaseUrl),
  SUPABASE_ANON_KEY: Boolean(supabaseAnonKey),
  SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceRoleKey),
};
const missingEnvVars = Object.entries(envStatus).filter(([, present]) => !present).map(([name]) => name);
if (missingEnvVars.length > 0) {
  console.error("[api/_lib] Missing required environment variable(s):", missingEnvVars.join(", "));
} else {
  console.log("[api/_lib] Server environment variables present:", envStatus);
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function getBearerToken(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

export async function requireUser(req, res) {
  // If the server itself isn't configured, don't tell the user their
  // session is bad — that's misleading and sends them in circles signing
  // out/in forever. Surface it as a server error instead.
  if (missingEnvVars.length > 0) {
    console.error("[requireUser] Rejecting request — server misconfigured, missing:", missingEnvVars.join(", "));
    res.status(500).json({ error: "Server is misconfigured (missing Supabase environment variables). This is not a problem with your account." });
    return null;
  }

  const token = getBearerToken(req);
  if (!token) {
    console.warn("[requireUser] No Authorization header / Bearer token on request to", req.url);
    res.status(401).json({ error: "Sign in is required." });
    return null;
  }

  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) {
    // Log the real Supabase error — this is what tells you WHY it failed:
    // expired token, wrong project (URL/anon key mismatch), malformed JWT, etc.
    console.error("[requireUser] supabase.auth.getUser() rejected the token on", req.url, "—", {
      message: error?.message,
      status: error?.status,
      name: error?.name,
    });
    res.status(401).json({ error: "Your session is invalid or expired. Please sign in again." });
    return null;
  }
  return data.user;
}

export function getOrigin(req) {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  const forwardedProto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${forwardedProto}://${host}`;
}

export function jsonMethod(req, res, method = "POST") {
  if (req.method === method) return true;
  res.setHeader("Allow", method);
  res.status(405).json({ error: "Method not allowed" });
  return false;
}

// The single source of truth for "when does this booking's session actually
// start and end." Used by both stripe-webhook.js (confirmation email copy)
// and send-reminders.js (halfway / ending-soon timing) — they must never
// compute this independently, or the two can drift out of sync.
//
// Rule: a session starts at its booked start time — full stop, no early
// starts, no check-in concept.
//   - Real-time ("park now") booking: no scheduled date/time was picked, so
//     the booked start time IS the moment of payment (paid_at).
//   - Advance booking: booking_date + start_hour were picked at booking
//     time, so that's the booked start time, regardless of when payment
//     happened (could be days earlier).
// Either way, the session always runs for exactly `hours` — end is always
// derived from start + hours, never from a separately-stored end_hour, so
// there's one single source of truth for duration.
//
// KNOWN LIMITATION: booking_date/start_hour have no timezone attached
// anywhere in the schema, so this treats them as UTC (Node's default when
// parsing a date string with no offset on a server). Revisit this once the
// advance-booking date/time picker UI actually exists and we know what
// timezone it's collecting in.
export function getSessionWindow(booking) {
  let start;
  if (booking.booking_date && booking.start_hour !== null && booking.start_hour !== undefined && booking.start_hour !== "") {
    const startHour = Number(booking.start_hour);
    const hh = String(Math.floor(startHour)).padStart(2, "0");
    const mm = String(Math.round((startHour % 1) * 60)).padStart(2, "0");
    const candidate = new Date(`${booking.booking_date}T${hh}:${mm}:00Z`);
    start = isNaN(candidate.getTime()) ? new Date(booking.paid_at) : candidate;
  } else {
    start = new Date(booking.paid_at);
  }
  const end = new Date(start.getTime() + Number(booking.hours) * 3600 * 1000);
  const isAdvance = start.getTime() - new Date(booking.paid_at).getTime() > 5 * 60 * 1000; // scheduled >5 min after payment
  return { start, end, isAdvance };
}

// Capacity-based availability check — this is the ONE place that decides
// whether a listing has a free spot for a given time window. Used both to
// show a live "X available now" count to renters browsing, and to enforce
// it server-side right before a Stripe Checkout Session is created (so a
// renter is never even offered a payment link for a spot that's already
// full — see create-checkout-session.js).
//
// Model: `listings.spaces` is a total capacity count, not individually
// identified spots — there's no per-spot booking record. So "available"
// means "fewer confirmed bookings overlap this window than total spaces,"
// not "this specific lettered spot is free." The spot-letter picker in the
// UI is a renter preference, not something this system can authoritatively
// track per-letter.
export async function checkAvailability(listingId, spaces, start, end) {
  // Bounded to bookings that could plausibly overlap `end` — mirrors the
  // same 31-day reasoning used in send-reminders.js, keeps this a cheap
  // query even as the table grows. Widen if MAX_HOURS in
  // create-checkout-session.js ever grows past 31 days.
  const since = new Date(Math.min(start.getTime(), Date.now()) - 31 * 24 * 3600 * 1000).toISOString();

  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select("id, hours, paid_at, booking_date, start_hour")
    .eq("listing_id", listingId)
    .eq("status", "confirmed")
    .not("paid_at", "is", null)
    .gte("paid_at", since);
  if (error) throw error;

  const overlapping = (bookings || []).filter((b) => {
    const w = getSessionWindow(b);
    return w.start.getTime() < end.getTime() && start.getTime() < w.end.getTime();
  });

  const spacesTaken = overlapping.length;
  const spacesFree = Math.max(0, Number(spaces) - spacesTaken);
  return { available: spacesFree > 0, spacesTotal: Number(spaces), spacesTaken, spacesFree };
}

// Letter-specific availability check — the piece checkAvailability() above
// explicitly does NOT do (see its comment: "available" there means capacity
// count, not a specific lettered spot). This is what actually answers "is
// Spot D free for this window," which nothing in the app currently checks
// anywhere — not at original booking time, not for extensions.
//
// Same overlap-window approach as checkAvailability(), just filtered to
// bookings matching this exact spot_label instead of counting all of them.
// Comparison is trimmed/uppercased since spot_label is expected to be a
// bare letter ("D"), matching how it's already treated elsewhere (see the
// spot_label parsing note in test-emails.js and stripe-webhook.js).
//
// NOTE: this only checks for a CONFLICT on the specific letter — it does
// NOT also enforce overall capacity. Callers that need both (e.g.
// create-checkout-session.js) should call checkAvailability() as well,
// same as today.
export async function checkSpotAvailability(listingId, spotLabel, start, end) {
  const label = String(spotLabel || "").trim().toUpperCase();
  if (!label) return { available: true, spotLabel: label }; // no letter requested -> nothing to conflict with

  const since = new Date(Math.min(start.getTime(), Date.now()) - 31 * 24 * 3600 * 1000).toISOString();

  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select("id, hours, paid_at, booking_date, start_hour, spot_label")
    .eq("listing_id", listingId)
    .eq("status", "confirmed")
    .not("paid_at", "is", null)
    .gte("paid_at", since);
  if (error) throw error;

  const conflict = (bookings || []).find((b) => {
    if (String(b.spot_label || "").trim().toUpperCase() !== label) return false;
    const w = getSessionWindow(b);
    return w.start.getTime() < end.getTime() && start.getTime() < w.end.getTime();
  });

  return { available: !conflict, spotLabel: label, conflictingBookingId: conflict?.id ?? null };
}
