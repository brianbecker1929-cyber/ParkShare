import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, mock, test } from "node:test";
import { getBookingDisplayStatus } from "../src/lib/bookingTime.js";

// Exercise the actual authenticated handlers and Supabase query projections.
// Every HTTP request is intercepted; Stripe refunds are a local spy only.
process.env.STRIPE_SECRET_KEY = "sk_test_bug005166_fixture_only";
process.env.SUPABASE_URL = "https://bug005166.invalid";
process.env.SUPABASE_ANON_KEY = "bug005166-fixture-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "bug005166-fixture-service";

const DRIVER = "00000000-0000-4000-8000-000000000022";
const HOST = "00000000-0000-4000-8000-000000000021";
const OTHER = "00000000-0000-4000-8000-000000000023";
const NOW = Date.parse("2026-10-20T16:00:00Z"); // Toronto noon; Greece 19:00.
const fixture = () => ({
  id: 166, listing_id: 11, renter_id: DRIVER, status: "confirmed",
  booking_date: "2026-10-20", start_hour: 14, hours: 1, total: 13.8,
  paid_at: "2026-10-18T10:00:00Z", created_at: "2026-10-18T10:00:00Z",
  scheduled_starts_at: "2026-10-20T18:00:00Z", property_time_zone: "America/Toronto",
  stripe_checkout_session_id: "cs_fixture", stripe_payment_intent_id: "pi_fixture",
  stripe_connected_account_id: "acct_fixture", refund_status: null, refund_ledger_revision: 0,
});

let accountBookings, cancelBooking, clientWindow, clientDisplay;
let rows, actor, requests, refunds, stripeRefundMock;

function project(row, columns) {
  return Object.fromEntries(columns.split(",").map(key => [key.trim(), row[key.trim()] ?? null]));
}

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    json(body) { this.body = body; return this; },
  };
}

async function list(view) {
  const res = response();
  await accountBookings({ method: "GET", query: { view }, headers: { authorization: "Bearer fixture" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

async function cancel() {
  const res = response();
  await cancelBooking({ method: "POST", body: { bookingId: 166 }, headers: { authorization: "Bearer fixture" } }, res);
  return res;
}

before(async () => {
  mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.origin, "https://bug005166.invalid", "unexpected outbound request");
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: actor, aud: "authenticated", app_metadata: {}, user_metadata: {} });
    }
    const table = url.pathname.split("/").pop();
    const method = options.method || "GET";
    requests.push({ table, method, query: url.searchParams });
    const tables = {
      bookings: rows,
      listings: [{ id: 11, host_id: HOST, title: "Test driveway", address: "Fixture address", spaces: 1 }],
      profiles: [{ id: HOST, name: "Host" }, { id: DRIVER, name: "Driver" }],
      reviews: [], booking_extensions: [],
    };
    assert.ok(Object.hasOwn(tables, table), `Unexpected table ${table}`);
    let data = tables[table].filter(row => [...url.searchParams].every(([key, value]) => {
      if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
      if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
      return true;
    }));
    if (method === "PATCH") {
      const update = JSON.parse(options.body);
      for (const row of data) Object.assign(row, update);
    } else assert.equal(method, "GET");
    data = data.map(row => project(row, url.searchParams.get("select")));
    const accept = new Headers(options.headers).get("accept") || "";
    return Response.json(accept.includes("application/vnd.pgrst.object+json") ? data[0] : data);
  });
  const lib = await import("../api/_lib.js");
  stripeRefundMock = mock.method(lib.stripe.refunds, "create", async (...args) => {
    refunds.push(args);
    return { id: "re_fixture", status: "succeeded", amount: 1380 };
  });
  ({ default: accountBookings } = await import("../api/account-bookings.js"));
  ({ default: cancelBooking } = await import("../api/cancel-booking.js"));
  // Execute the real browser date/window functions without mounting React or
  // replacing them with another copy of the calculation in the test.
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const start = app.indexOf("function clientBookingWindow(");
  const end = app.indexOf("async function requestBookingCancellation(", start);
  assert.ok(start >= 0 && end > start);
  ({ clientBookingWindow: clientWindow, clientBookingDisplay: clientDisplay } = new Function(
    app.slice(start, end) + "; return { clientBookingWindow, clientBookingDisplay };"
  )());
});

beforeEach(() => {
  actor = DRIVER; rows = [fixture()]; requests = []; refunds = [];
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: NOW });
  stripeRefundMock.mock.resetCalls();
});
after(() => { mock.timers.reset(); mock.restoreAll(); });

for (const view of ["driver", "host"]) {
  test(`${view} booking response preserves canonical start and Toronto display instead of premature completion`, async () => {
    actor = view === "driver" ? DRIVER : HOST;
    const payload = await list(view);
    assert.equal(payload.bookings.length, 1);
    const booking = payload.bookings[0];
    assert.equal(booking.scheduled_starts_at, "2026-10-20T18:00:00Z");
    assert.equal(booking.property_time_zone, "America/Toronto");
    assert.equal("stripe_checkout_session_id" in booking, false);
    const window = clientWindow(booking);
    assert.equal(window.start.toISOString(), "2026-10-20T18:00:00.000Z");
    assert.equal(getBookingDisplayStatus("Upcoming", window.start, window.end, NOW), "Upcoming");
    assert.match(clientDisplay(window.start, true, window.end, booking.property_time_zone).startTime, /2:00\s*p\.?m\.?/i);
    assert.equal(rows[0].status, "confirmed", "reading does not mutate paid bookings");
    assert.equal(requests.some(r => r.method !== "GET"), false);
  });
}

test("Driver with two hours of notice can cancel using the canonical UTC start", async () => {
  const res = await cancel();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.bookingStatus, "refunded");
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0][0].payment_intent, "pi_fixture");
  assert.equal(refunds[0][1].stripeAccount, "acct_fixture");
  assert.equal(refunds[0][1].idempotencyKey, "booking-cancel-166");
});

for (const view of ['driver','host']) test(`${view} reservations exclude rejected financial audits while Transactions retains their separate history`,async()=>{
  actor=view==='host'?HOST:DRIVER;
  rows.push({...fixture(),id:167,application_state:'rejected',status:'refunded'});
  const result=await list(view);
  assert.deepEqual(result.bookings.map(b=>b.id),[166]);
  assert.equal(rows.length,2,'Reading reservations never deletes the rejected audit');
});

test("exactly one hour notice remains eligible; repeat cancellation does not issue another refund", async () => {
  mock.timers.setTime(Date.parse("2026-10-20T17:00:00Z"));
  assert.equal((await cancel()).statusCode, 200);
  const repeat = await cancel();
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.body.alreadyProcessed, true);
  assert.equal(refunds.length, 1);
});

for (const [time, code] of [["17:00:01", "late"], ["18:00:00", "started"], ["19:00:00", "started"]]) {
  test(`Driver cancellation at ${time}Z is rejected without issuing a refund`, async () => {
    mock.timers.setTime(Date.parse(`2026-10-20T${time}Z`));
    const res = await cancel();
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, code);
    assert.equal(refunds.length, 0);
  });
}

test("Host can cancel before canonical start even inside the Driver notice cutoff", async () => {
  actor = HOST;
  mock.timers.setTime(Date.parse("2026-10-20T17:30:00Z"));
  assert.equal((await cancel()).statusCode, 200);
  assert.equal(refunds[0][0].metadata.cancelled_by, "host");
});

test("unrelated user cannot list or cancel this booking", async () => {
  actor = OTHER;
  assert.deepEqual((await list("driver")).bookings, []);
  const res = await cancel();
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, "forbidden");
  assert.equal(refunds.length, 0);
});

test("legacy paid booking retains its recorded UTC window and is not silently moved", async () => {
  rows[0].scheduled_starts_at = null;
  rows[0].property_time_zone = null;
  const booking = (await list("driver")).bookings[0];
  const window = clientWindow(booking);
  assert.equal(window.start.toISOString(), "2026-10-20T14:00:00.000Z");
  assert.equal(getBookingDisplayStatus("Upcoming", window.start, window.end, NOW), "Completed");
  assert.equal((await cancel()).body.code, "started");
  assert.equal(refunds.length, 0);
  assert.equal(rows[0].scheduled_starts_at, null);
});

test("Book Now remains ineligible for automatic Driver cancellation", async () => {
  Object.assign(rows[0], { scheduled_starts_at: null, property_time_zone: null,
    booking_date: null, start_hour: null, paid_at: "2026-10-20T18:00:00Z" });
  assert.equal((await cancel()).body.code, "book_now");
  assert.equal(refunds.length, 0);
});

test("invalid canonical instant fails closed without refunding the legacy fallback time", async () => {
  rows[0].scheduled_starts_at = "invalid";
  assert.equal((await cancel()).statusCode, 500);
  assert.equal(refunds.length, 0);
});

test('refunding only a remaining balance waits for cumulative reconciliation instead of falsely claiming a full refund',async()=>{
 stripeRefundMock.mock.mockImplementationOnce(async(...args)=>{refunds.push(args);return {id:'re_remaining',status:'succeeded',amount:690};});
 const res=await cancel();assert.equal(res.statusCode,202);assert.equal(res.body.bookingStatus,'confirmed');assert.match(res.body.message,/cumulative refund status is being reconciled/);
 assert.equal(rows[0].cancelled_at,null);
 const again=await cancel();assert.equal(again.statusCode,200);assert.equal(again.body.alreadyProcessed,true);assert.equal(refunds.length,1);
});
test('a webhook revision change while Stripe responds cannot be overwritten by the cancellation response',async()=>{
 stripeRefundMock.mock.mockImplementationOnce(async(...args)=>{refunds.push(args);rows[0].refund_ledger_revision++;rows[0].stripe_refund_id='re_webhook_first';rows[0].refund_total_amount=6.9;return {id:'re_remaining',status:'succeeded',amount:690};});
 const res=await cancel();assert.equal(res.statusCode,202);assert.equal(rows[0].stripe_refund_id,'re_webhook_first');assert.equal(rows[0].refund_total_amount,6.9);assert.match(res.body.message,/being reconciled/);
});
