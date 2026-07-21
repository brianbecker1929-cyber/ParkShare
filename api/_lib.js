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
