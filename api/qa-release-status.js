// QA-only release readiness. Never returns credentials or customer data.
import { supabaseAdmin } from "./_lib.js";
const QA_URL = "https://biydlfekindgaslgktsx.supabase.co";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (process.env.SUPABASE_URL !== QA_URL || (process.env.VERCEL_PROJECT_ID && process.env.VERCEL_PROJECT_ID !== "prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC")) return res.status(404).json({ error: "Not found" });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const checks = {
    qaDatabase: process.env.VITE_SUPABASE_URL === QA_URL,
    stripeTestMode: /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || ""),
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    mapsConfigured: Boolean(process.env.VITE_GOOGLE_MAPS_API_KEY),
    qaLinks: process.env.APP_URL?.replace(/\/$/, "") === "https://parkshare-qa.vercel.app",
  };
  const {error} = await supabaseAdmin.from("listings").select("id,time_zone", {count:"exact",head:true});
  checks.schemaReady = !error;
  const ready = Object.values(checks).every(Boolean);
  return res.status(ready ? 200 : 503).json({ ready, commit: process.env.VERCEL_GIT_COMMIT_SHA || null, checks });
}
