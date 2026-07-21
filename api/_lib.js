import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
  console.warn("Missing one or more Supabase server environment variables.");
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
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Sign in is required." });
    return null;
  }

  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data?.user) {
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
