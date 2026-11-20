import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { readFile } from "node:fs/promises";
import { cancelledCheckoutHold, listingSpotStatusText } from "../src/lib/spotAvailability.js";

process.env.STRIPE_SECRET_KEY = "sk_test_abandoned_fixture";
process.env.SUPABASE_URL = "https://abandoned.invalid";
process.env.SUPABASE_ANON_KEY = "synthetic-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service";
const ID = "10000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-000000000011";
const NOW = Date.parse("2030-10-21T14:00:00Z");
let lib, cancel, availability, tables, actor, session, requests, provider, retrieveError, expireError, deleteError, dbError, afterExpiry;
const result = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
  setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } });
async function run({ body = { holdId: ID }, method = "POST", auth = true } = {}) {
  const res = result();
  await cancel({ method, body, headers: auth ? { authorization: "Bearer synthetic" } : {} }, res);
  return res;
}
before(async () => {
  mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.origin, "https://abandoned.invalid", "No live network or payment calls");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: actor, aud: "authenticated" });
    const table = url.pathname.split("/").at(-1), method = options.method || "GET";
    requests.push({ table, method, params: url.searchParams });
    assert.ok(Object.hasOwn(tables, table), table);
    if (dbError === table || (deleteError && method === "DELETE")) return Response.json({ message: "Synthetic failure", code: "XX000" }, { status: 500 });
    const matches = row => [...url.searchParams].every(([key, value]) => {
      if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
      if (value === "not.is.null") return row[key] != null;
      if (value.startsWith("gt.")) return Date.parse(row[key]) > Date.parse(value.slice(3));
      if (value.startsWith("lt.")) return Date.parse(row[key]) < Date.parse(value.slice(3));
      return true;
    });
    const rows = tables[table].filter(matches);
    if (method === "DELETE") {
      assert.equal(table, "booking_holds", "Cancellation can only release holds");
      assert.equal(session.status, "expired"); assert.equal(session.payment_status, "unpaid");
      tables[table] = tables[table].filter(row => !matches(row));
      return new Response(null, { status: 204 });
    }
    assert.equal(method, "GET", "No booking/refund/payment writes");
    const accept = new Headers(options.headers).get("accept") || "";
    return Response.json(accept.includes("application/vnd.pgrst.object+json") ? rows[0] ?? null : rows);
  });
  lib = await import("../api/_lib.js");
  mock.method(lib.stripe.checkout.sessions, "retrieve", async (id, params, options) => {
    provider.push("retrieve"); assert.equal(id, "cs_test_owned"); assert.deepEqual(params, {});
    assert.deepEqual(options, { stripeAccount: "acct_owned" });
    if (retrieveError) throw Error("Synthetic Stripe read failure");
    return { ...session };
  });
  mock.method(lib.stripe.checkout.sessions, "expire", async (id, params, options) => {
    provider.push("expire"); assert.equal(id, "cs_test_owned");
    assert.deepEqual(options, { stripeAccount: "acct_owned" });
    if (expireError) throw Error("Payment won expiry race");
    session.status = "expired"; afterExpiry?.(); return { ...session };
  });
  mock.method(lib.stripe.refunds, "create", () => assert.fail("No refunds"));
  mock.method(lib.stripe.checkout.sessions, "create", () => assert.fail("No new checkout"));
  ({ default: cancel } = await import("../api/cancel-booking-checkout.js"));
  ({ default: availability } = await import("../api/listing-availability.js"));
});
beforeEach(() => {
  mock.timers.reset(); mock.timers.enable({ apis: ["Date"], now: NOW });
  actor = OWNER; requests = []; provider = [];
  retrieveError = expireError = deleteError = false; dbError = afterExpiry = null;
  session = { id: "cs_test_owned", mode: "payment", status: "open", payment_status: "unpaid", currency: "cad", amount_total: 1380, livemode: false };
  const hold = { id: ID, listing_id: 7, renter_id: OWNER, spot_label: "A", starts_at: new Date(NOW).toISOString(),
    ends_at: new Date(NOW + 3600000).toISOString(), expires_at: new Date(NOW + 1800000).toISOString(),
    stripe_checkout_session_id: session.id, expected_connected_account_id: "acct_owned", expected_total_cents: 1380,
    checkout_metadata: { hold_id: ID, listing_id: "7", renter_id: OWNER, connected_account_id: "acct_owned",
      hours: "1", total_cents: "1380", subtotal_cents: "1200", service_fee_cents: "180", spot_label: "A" } };
  tables = { booking_holds: [hold], bookings: [], pending_booking_extensions: [],
    listings: [{ id: 7, spaces: 2, spots: [{ forRent: true }, { forRent: true }], availability: null, time_zone: "America/Toronto" }] };
});
after(() => { mock.timers.reset(); mock.restoreAll(); });

test("cancel verifies expiry at Stripe before releasing only the caller's exact registered hold", async () => {
  tables.booking_holds.push({ ...tables.booking_holds[0], id: ID.replace(/1$/, "2"), renter_id: "other", spot_label: "B" });
  const res = await run(); assert.equal(res.statusCode, 200); assert.equal(res.body.status, "released");
  assert.deepEqual(provider, ["retrieve", "expire", "retrieve"]);
  assert.equal(tables.booking_holds.length, 1); assert.equal(tables.booking_holds[0].renter_id, "other");
  const deletion = requests.find(row => row.method === "DELETE");
  for (const [key, value] of Object.entries({ id: ID, renter_id: OWNER, stripe_checkout_session_id: session.id, expected_connected_account_id: "acct_owned" })) assert.equal(deletion.params.get(key), "eq." + value);
  assert.equal(res.headers["Cache-Control"], "private, no-store");
});
test("unauthenticated, malformed, GET and other-account cancellation cannot touch Stripe or inventory", async () => {
  assert.equal((await run({ auth: false })).statusCode, 401);
  assert.equal((await run({ method: "GET" })).statusCode, 405);
  for (const holdId of [null, 12, [], ID + " OR true", "", "../hold"]) assert.equal((await run({ body: { holdId } })).statusCode, 400);
  actor = "another-driver"; const other = await run(); assert.equal(other.body.status, "not_found");
  assert.equal(provider.length, 0); assert.equal(tables.booking_holds.length, 1);
});
test("paid, complete, asynchronous-pending and mismatching provider sessions cannot release inventory", async () => {
  for (const changes of [{ payment_status: "paid" }, { status: "complete" }, { payment_status: "no_payment_required" },
    { id: "cs_other" }, { currency: "usd" }, { amount_total: 1 }, { mode: "subscription" }, { livemode: null }]) {
    const original = { ...session }; Object.assign(session, changes);
    assert.equal((await run()).statusCode, 409, JSON.stringify(changes));
    assert.equal(tables.booking_holds.length, 1); session = original;
  }
  assert.ok(!provider.includes("expire"));
});
test("a booking or pending extension registration blocks initial-checkout cancellation", async () => {
  for (const table of ["bookings", "pending_booking_extensions"]) {
    tables[table].push({ id: 1, stripe_checkout_session_id: session.id });
    assert.equal((await run()).statusCode, 409); tables[table] = [];
  }
  assert.equal(provider.length, 0); assert.equal(tables.booking_holds.length, 1);
});
test("failed Stripe reads/expiry and payment winning the expiry race preserve the hold", async () => {
  retrieveError = true; assert.equal((await run()).statusCode, 503); retrieveError = false;
  expireError = true; assert.equal((await run()).statusCode, 503); expireError = false;
  afterExpiry = () => { session.status = "complete"; session.payment_status = "paid"; };
  assert.equal((await run()).statusCode, 409); assert.equal(tables.booking_holds.length, 1);
  assert.ok(!requests.some(row => row.method === "DELETE"));
});
test("changed Stripe mode between reads fails closed", async () => {
  afterExpiry = () => { session.livemode = true; };
  assert.equal((await run()).statusCode, 409); assert.equal(tables.booking_holds.length, 1);
});
test("database errors do not claim release; a retry resumes an already-expired session", async () => {
  deleteError = true; assert.equal((await run()).statusCode, 503); assert.equal(tables.booking_holds.length, 1);
  deleteError = false; assert.equal((await run()).body.status, "released");
  assert.equal(provider.filter(call => call === "expire").length, 1);
  assert.equal((await run()).body.status, "not_found");
});
test("invalid trusted snapshots and failed registration reads cannot expire or delete anything", async () => {
  tables.booking_holds[0].checkout_metadata.renter_id = "forged";
  assert.equal((await run()).statusCode, 503); assert.equal(provider.length, 0);
  tables.booking_holds[0].checkout_metadata.renter_id = OWNER;
  for (const table of ["booking_holds", "bookings", "pending_booking_extensions"]) {
    dbError = table; assert.equal((await run()).statusCode, 503); assert.equal(provider.length, 0);
  }
  assert.equal(tables.booking_holds.length, 1);
});
const window = () => [new Date(NOW), new Date(NOW + 3600000)];
test("availability distinguishes a held bay from paid bookings without exposing hold/account identifiers", async () => {
  tables.bookings.push({ id: 100, listing_id: 7, status: "confirmed", hours: 1, paid_at: new Date(NOW).toISOString(), spot_label: "B" });
  const res = result(); await availability({ method: "GET", query: { listingId: "7", hours: "1" } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(res.body.spotState, { A: "held", B: "booked" });
  assert.deepEqual(res.body.spotStatus, { A: false, B: false }); assert.equal(res.body.available, false);
  assert.doesNotMatch(JSON.stringify(res.body), /acct_|cs_test|renter_id|checkout_metadata|10000000-/);
});
test("abandonment expires by wall clock without a webhook or database deletion; active holds remain locked", async () => {
  assert.deepEqual(await lib.checkAllSpotAvailability(7, ["A", "B"], ...window()), { A: false, B: true });
  mock.timers.setTime(NOW + 1800000);
  const state = await lib.checkAllSpotAvailability(7, ["A", "B"], ...window(), { includeStates: true });
  assert.deepEqual(state.spotState, { A: "available", B: "available" }); assert.equal(tables.booking_holds.length, 1);
});
test("paid bookings stay blocked after hold expiry and cancellation cannot remove them", async () => {
  tables.bookings.push({ id: 101, listing_id: 7, status: "confirmed", hours: 1, paid_at: new Date(NOW).toISOString(), spot_label: "A", stripe_checkout_session_id: session.id });
  mock.timers.setTime(NOW + 1800001);
  const state = await lib.checkAllSpotAvailability(7, ["A"], ...window(), { includeStates: true });
  assert.equal(state.spotState.A, "booked"); assert.equal(state.spotStatus.A, false);
  assert.equal((await run()).statusCode, 409); assert.equal(tables.bookings.length, 1);
});
test("different future windows are not blocked by the abandoned current checkout", async () => {
  const start = new Date(NOW + 7200000), end = new Date(NOW + 10800000);
  assert.equal((await lib.checkAllSpotAvailability(7, ["A"], start, end, { includeStates: true })).spotState.A, "available");
});
test("spot copy never claims an unpaid hold or an unknown result is a paid booking", () => {
  const args = { hostEnabled: true, isRealListing: true, isAvailable: false, label: "A" };
  assert.equal(listingSpotStatusText({ ...args, availableData: { available: false, spotState: { A: "held" } } }), "Checkout in progress");
  assert.equal(listingSpotStatusText({ ...args, availableData: { available: true, spotState: { A: "booked" } } }), "Already booked");
  assert.equal(listingSpotStatusText({ ...args, availableData: { available: true } }), "Unavailable");
  assert.equal(listingSpotStatusText({ ...args, availableData: null }), "Checking…");
});
test("only a well-formed initial cancellation reference can request cleanup", async () => {
  assert.equal(cancelledCheckoutHold(`?booking_cancelled=1&checkout_hold=${ID}`), ID);
  for (const query of [`?booking_success=1&checkout_hold=${ID}`, `?extension_cancelled=1&checkout_hold=${ID}`, `?booking_cancelled=false&checkout_hold=${ID}`, "?booking_cancelled=1&checkout_hold=invalid", ""]) assert.equal(cancelledCheckoutHold(query), null);
  const source = await readFile(new URL("../api/create-checkout-session.js", import.meta.url), "utf8");
  assert.match(source, /cancel_url:.*booking_cancelled=1&checkout_hold=\$\{encodeURIComponent\(holdId\)\}/);
});

test("BUG-005250 availability returns the same real bay labels as the picker for one through eight bays", async () => {
  tables.booking_holds = [];
  for (const count of [1, 2, 3, 4, 6, 8]) {
    for (const configured of [false, true]) {
      Object.assign(tables.listings[0], { spaces: count, spots: configured ? Array.from({length:count}, () => ({forRent:true})) : [] });
      const res = result(); await availability({method:"GET",query:{listingId:"7",hours:"1"}},res);
      assert.equal(res.statusCode,200); assert.deepEqual(Object.keys(res.body.spotStatus),Array.from({length:count},(_,i)=>String.fromCharCode(65+i)));
    }
  }
});
test("BUG-005250 private physical gaps do not renumber later rentable bays in availability", async () => {
  tables.booking_holds = [];
  Object.assign(tables.listings[0], { spaces:3, spots:[false,true,false,false,true,false,false,true].map(forRent=>({forRent})) });
  const res=result(); await availability({method:"GET",query:{listingId:"7",hours:"1"}},res);
  assert.equal(res.statusCode,200); assert.deepEqual(res.body.spotStatus,{B:true,E:true,H:true});
});
test("BUG-005251 a full current four-bay window does not block a free future property-local slot", async () => {
  tables.booking_holds=[]; Object.assign(tables.listings[0],{spaces:4,spots:Array.from({length:4},()=>({forRent:true}))});
  tables.bookings=Array.from({length:4},(_,i)=>({id:i+1,listing_id:7,status:"confirmed",hours:1,paid_at:new Date(NOW).toISOString(),spot_label:String.fromCharCode(65+i)}));
  const current=result(); await availability({method:"GET",query:{listingId:"7",hours:"1"}},current);assert.equal(current.body.available,false);
  const future=result(); await availability({method:"GET",query:{listingId:"7",hours:"1",bookingDate:"2030-10-22",startHour:"9"}},future);
  assert.equal(future.statusCode,200);assert.equal(future.body.available,true);assert.equal(future.body.spacesFree,4);assert.deepEqual(future.body.spotStatus,{A:true,B:true,C:true,D:true});assert.equal(tables.bookings.length,4);
});
