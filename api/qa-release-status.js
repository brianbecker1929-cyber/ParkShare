// QA-only release readiness. Never returns credentials or customer data.
import { supabaseAdmin } from "./_lib.js";
import {resolveListingTimeZone} from "./_listing-time-zone.js";
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
  const cleanupSchema = await supabaseAdmin.from("listing_photo_cleanup").select("object_path", {head:true});
  checks.photoCleanupReady = !cleanupSchema.error && Boolean(process.env.CRON_SECRET);
  const reminders = await supabaseAdmin.from("booking_reminder_deliveries").select("id,payload,lease_until,provider_id,sent_at", {head:true});
  checks.remindersReady = !reminders.error && checks.emailConfigured && Boolean(process.env.CRON_SECRET);
  const refundEmails = await supabaseAdmin.from("refund_email_deliveries").select("id,payload,sent_at,blocked_at", {head:true});
  checks.refundNotificationsReady = !refundEmails.error && checks.emailConfigured && Boolean(process.env.CRON_SECRET);
  const ledgerSchema = await supabaseAdmin.from("payment_refunds").select("refund_id", {head:true});
  const bookingLedger = await supabaseAdmin.from("bookings").select("refund_ledger_revision,refund_total_amount,refund_pending_amount", {head:true});
  const extensionLedger = await supabaseAdmin.from("booking_extensions").select("application_state,refund_ledger_revision,refund_total_amount,refund_pending_amount", {head:true});
  checks.refundLedgerReady = !ledgerSchema.error && !bookingLedger.error && !extensionLedger.error;
  const publicParking = await supabaseAdmin.rpc("public_parking_page", {p_before_id: 1});
  checks.boundedPublicParkingReady = !publicParking.error;
  try {
    checks.propertyTimezoneLookupReady = resolveListingTimeZone({lat:43.65,lng:-79.38}) === "America/Toronto"
      && resolveListingTimeZone({lat:46.77,lng:23.59}) === "Europe/Bucharest";
  } catch { checks.propertyTimezoneLookupReady = false; }
  const publishingGuard = await supabaseAdmin.rpc("listing_timezone_assignment_ready");
  checks.propertyTimezoneGuardReady = !publishingGuard.error && publishingGuard.data === true;
  const publication = await supabaseAdmin.rpc("listing_publication_ready");
  checks.listingPublicationReady = !publication.error && publication.data === true;
  const ready = Object.values(checks).every(Boolean);
  return res.status(ready ? 200 : 503).json({ ready, commit: process.env.VERCEL_GIT_COMMIT_SHA || null, checks });
}
