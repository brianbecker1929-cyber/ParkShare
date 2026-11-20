// One fixed TEST fixture for BUG-005188. No public endpoint or database writes.
import { pathToFileURL } from "node:url";
import { getSessionWindow } from "../api/_booking-rules.js";

export const FIXTURE = Object.freeze({
  bookingId: 110, listingId: 24, totalCents: 1413, refundCents: 100,
  paymentIntent: "pi_3UWIqY0U5Uldvkye0UrDDt3V", account: "acct_1UR7Pu0U5Uldvkye",
  platform: "acct_1Trzsc1FxWZlqoOQ", key: "parkshare-qa-bug005188-pk110-cad100-v1",
});
const QA_URL = "https://heqxirlsorcztsawaldg.supabase.co";
const PREVIEW = "https://parkshare-qa-git-qa-recovery-preflight-oct27-eska-technologies.vercel.app";
function requireFixture(value, message) { if (!value) throw new Error(`QA partial refund refused: ${message}`); }

export function validateFixtureEnvironment(env) {
  requireFixture(env.VERCEL_ENV === "preview"
    && env.VERCEL_PROJECT_ID === "prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC"
    && env.VERCEL_GIT_COMMIT_REF === "qa/recovery-preflight-oct27"
    && env.SUPABASE_URL === QA_URL && env.APP_URL?.replace(/\/$/, "") === PREVIEW
    && /^sk_test_/.test(env.STRIPE_SECRET_KEY || "") && Boolean(env.SUPABASE_SERVICE_ROLE_KEY), "environment isolation");
}
function checkRefund(refund, chargeId) {
  requireFixture(/^re_/.test(refund?.id || "") && refund.amount === FIXTURE.refundCents
    && refund.currency === "cad" && refund.charge === chargeId
    && refund.payment_intent === FIXTURE.paymentIntent
    && refund.metadata?.qa_fixture === FIXTURE.key
    && ["pending", "succeeded"].includes(refund.status), "refund verification");
}

export async function runPartialRefundFixture(env, { apply = false, fetcher = fetch, stripeClient, now = Date.now() } = {}) {
  validateFixtureEnvironment(env);
  const columns = "id,listing_id,status,application_state,total,paid_at,hours,booking_date,start_hour,scheduled_starts_at,stripe_payment_intent_id,stripe_connected_account_id,refund_total_amount,refund_pending_amount,refund_status,cancellation_requested_at";
  const response = await fetcher(`${QA_URL}/rest/v1/bookings?id=eq.${FIXTURE.bookingId}&select=${columns}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    signal: AbortSignal.timeout(20000),
  });
  requireFixture(response.ok, "booking read");
  const rows = await response.json(), b = rows?.[0];
  requireFixture(Array.isArray(rows) && rows.length === 1 && b.id === FIXTURE.bookingId
    && b.listing_id === FIXTURE.listingId && b.application_state === "applied"
    && b.stripe_payment_intent_id === FIXTURE.paymentIntent && b.stripe_connected_account_id === FIXTURE.account
    && Math.round(Number(b.total) * 100) === FIXTURE.totalCents && Boolean(b.paid_at), "booking identity");
  requireFixture(getSessionWindow(b).end.getTime() < now, "booking must have ended");
  if (!stripeClient) {
    const { default: Stripe } = await import("stripe");
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 0, timeout: 20000 });
  }
  requireFixture((await stripeClient.accounts.retrieve()).id === FIXTURE.platform, "platform account");
  const scope = { stripeAccount: FIXTURE.account };
  const pi = await stripeClient.paymentIntents.retrieve(FIXTURE.paymentIntent, { expand: ["latest_charge"] }, scope);
  const charge = pi.latest_charge;
  requireFixture(pi.id === FIXTURE.paymentIntent && pi.livemode === false && pi.currency === "cad"
    && pi.status === "succeeded" && pi.amount === FIXTURE.totalCents && pi.amount_received === FIXTURE.totalCents
    && charge && typeof charge === "object" && charge.livemode === false && charge.paid === true
    && charge.captured === true && charge.disputed === false && charge.amount === FIXTURE.totalCents, "paid TEST charge");
  const refunds = await stripeClient.refunds.list({ payment_intent: FIXTURE.paymentIntent, limit: 100 }, scope);
  requireFixture(refunds.has_more === false && Array.isArray(refunds.data), "refund history");
  const existing = refunds.data.find(refund => refund.metadata?.qa_fixture === FIXTURE.key);
  if (existing) {
    checkRefund(existing, charge.id);
    return { bookingId: FIXTURE.bookingId, refundId: existing.id, refundCents: existing.amount,
      currency: existing.currency, status: existing.status, alreadyCreated: true };
  }
  requireFixture(b.status === "confirmed" && !b.cancellation_requested_at && !b.refund_status
    && Number(b.refund_total_amount || 0) === 0 && Number(b.refund_pending_amount || 0) === 0
    && charge.amount_refunded === 0 && refunds.data.length === 0, "fixture already changed or refunded");
  const plan = { bookingId: FIXTURE.bookingId, paymentTotalCents: FIXTURE.totalCents,
    refundCents: FIXTURE.refundCents, currency: "cad", refundApplicationFee: "proportional" };
  if (!apply) return { ...plan, planOnly: true };
  const created = await stripeClient.refunds.create({ payment_intent: FIXTURE.paymentIntent,
    amount: FIXTURE.refundCents, refund_application_fee: true, metadata: { qa_fixture: FIXTURE.key, qa_bug: "BUG-005188" } },
  { ...scope, idempotencyKey: FIXTURE.key });
  checkRefund(created, charge.id);
  const verified = await stripeClient.refunds.retrieve(created.id, {}, scope);
  checkRefund(verified, charge.id);
  return { ...plan, refundId: verified.id, status: verified.status, alreadyCreated: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireFixture(process.argv.length <= 3 && [undefined, "--plan", "--apply"].includes(process.argv[2]), "command mode");
    console.info("QA partial refund fixture", JSON.stringify(await runPartialRefundFixture(process.env, { apply: process.argv[2] === "--apply" })));
  } catch {
    // Provider errors can contain request data. Do not print credentials or raw responses.
    console.error("QA partial refund fixture did not complete. Reconcile the fixed fixture/idempotency key before retrying.");
    process.exitCode = 1;
  }
}
