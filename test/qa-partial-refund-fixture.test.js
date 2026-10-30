import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE, runPartialRefundFixture } from "../scripts/qa-partial-refund-fixture.mjs";
const env = { VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC",
  VERCEL_GIT_COMMIT_REF: "qa/recovery-preflight-oct27", SUPABASE_URL: "https://heqxirlsorcztsawaldg.supabase.co",
  APP_URL: "https://parkshare-qa-git-qa-recovery-preflight-oct27-eska-technologies.vercel.app",
  STRIPE_SECRET_KEY: "sk_test_fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture_service" };
function fixture({ booking = {}, intent = {}, charge = {}, refunds = [] } = {}) {
  const writes = [], reads = [];
  const refund = { id: "re_fixture", amount: 100, currency: "cad", charge: "ch_fixture",
    payment_intent: FIXTURE.paymentIntent, status: "succeeded", metadata: { qa_fixture: FIXTURE.key } };
  const stripeClient = { accounts: { retrieve: async () => ({ id: FIXTURE.platform }) },
    paymentIntents: { retrieve: async (id, params, scope) => {
      assert.equal(id, FIXTURE.paymentIntent); assert.equal(scope.stripeAccount, FIXTURE.account);
      return { id, amount: 1413, amount_received: 1413, status: "succeeded", currency: "cad", livemode: false,
        latest_charge: { id: "ch_fixture", livemode: false, paid: true, captured: true, disputed: false,
          amount: 1413, amount_refunded: 0, ...charge }, ...intent };
    } }, refunds: { list: async (params, scope) => {
      assert.equal(params.payment_intent, FIXTURE.paymentIntent); assert.equal(scope.stripeAccount, FIXTURE.account);
      return { has_more: false, data: refunds };
    }, create: async (params, scope) => { writes.push({ params, scope }); return refund; },
    retrieve: async (id, params, scope) => { assert.equal(id, refund.id); assert.equal(scope.stripeAccount, FIXTURE.account); return refund; } } };
  const fetcher = async (url, init) => {
    reads.push(url); assert.ok(url.startsWith(env.SUPABASE_URL + "/rest/v1/bookings?id=eq.110&select="));
    assert.equal(init.method, undefined, "No database write");
    return Response.json([{ id: 110, listing_id: 24, status: "confirmed", application_state: "applied", total: "14.13",
      paid_at: "2026-10-29T09:00:00Z", hours: 1, stripe_payment_intent_id: FIXTURE.paymentIntent,
      stripe_connected_account_id: FIXTURE.account, refund_total_amount: null, refund_pending_amount: null,
      refund_status: null, cancellation_requested_at: null, ...booking }]);
  };
  return { writes, reads, refund, run: (apply = false, overrides = {}) => runPartialRefundFixture({ ...env, ...overrides },
    { apply, fetcher, stripeClient, now: Date.parse("2026-10-30T18:00:00Z") }) };
}
test("partial refund fixture rejects every non-QA environment before any network request", async () => {
  for (const change of [{ VERCEL_ENV: "production" }, { VERCEL_PROJECT_ID: "other" },
    { VERCEL_GIT_COMMIT_REF: "main" }, { SUPABASE_URL: "https://oyxrussraxjgqwzpwyca.supabase.co" },
    { APP_URL: "https://www.myparkshare.ca" }, { STRIPE_SECRET_KEY: "sk_live_fixture" }, { SUPABASE_SERVICE_ROLE_KEY: "" }]) {
    const f = fixture(); await assert.rejects(f.run(true, change), /environment isolation/);
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
});
test("partial refund plan verifies the existing charge and performs no mutation", async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.planOnly, true); assert.equal(result.refundCents, 100); assert.equal(f.writes.length, 0);
});
test("partial refund applies exactly CAD 1 with connected-account scope and fixed idempotency", async () => {
  const f = fixture(), result = await f.run(true);
  assert.equal(result.refundId, "re_fixture"); assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].params.amount, 100); assert.equal(f.writes[0].params.refund_application_fee, true);
  assert.equal(f.writes[0].scope.stripeAccount, FIXTURE.account); assert.equal(f.writes[0].scope.idempotencyKey, FIXTURE.key);
});
test("active, foreign, refunded and unverified payment fixtures are rejected without a write", async () => {
  for (const changes of [{ booking: { id: 111 } }, { booking: { listing_id: 31 } },
    { booking: { scheduled_starts_at: "2050-01-01T00:00:00Z" } }, { booking: { refund_pending_amount: 1 } },
    { booking: { cancellation_requested_at: "2026-10-30T10:00:00Z" } }, { booking: { total: 20 } },
    { intent: { livemode: true } }, { intent: { currency: "usd" } }, { charge: { disputed: true } },
    { charge: { captured: false } }, { charge: { amount_refunded: 100 } }]) {
    const f = fixture(changes); await assert.rejects(f.run(true), /QA partial refund refused/); assert.equal(f.writes.length, 0);
  }
});
test("repeated execution finds the original marked refund rather than creating another", async () => {
  const sample = fixture().refund, f = fixture({ refunds: [sample], booking: { status: "partially_refunded", refund_total_amount: 1 }, charge: { amount_refunded: 100 } });
  const result = await f.run(true); assert.equal(result.alreadyCreated, true); assert.equal(result.refundId, sample.id);
  assert.equal(f.writes.length, 0);
});
test("an unrelated refund blocks the fixture rather than adding another refund", async () => {
  const f = fixture({ refunds: [{ ...fixture().refund, metadata: {} }] });
  await assert.rejects(f.run(true), /fixture already changed/); assert.equal(f.writes.length, 0);
});
