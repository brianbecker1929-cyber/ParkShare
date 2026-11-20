import test from "node:test";
import assert from "node:assert/strict";
import { parseMessageBookingId, bookingMessageListing, bookingMessageThread } from "../src/lib/bookingMessage.js";
import { confirmationEmailHtml } from "../api/_email.js";

test("email conversation links accept only valid booking IDs", () => {
  assert.equal(parseMessageBookingId("?message_booking=42"), 42);
  for (const id of ["", "0", "-1", "1.2", "1e3", "abc", "9007199254740993", "42/evil"]) {
    assert.equal(parseMessageBookingId(`?message_booking=${id}`), null, id);
    assert.match(confirmationEmailHtml({ bookingId: id }), /href="https:\/\/www\.myparkshare\.ca\/messages"/);
  }
});

test("booked listing and conversation retain the booking and correct recipient", () => {
  const context = { bookingId: 42, listing: { id: 7, title: "Sample driveway", price: 5, address: "Sample address" },
    hostName: "William", recipient: { id: "driver-1", name: "Sample Driver", role: "Driver" } };
  assert.equal(bookingMessageListing(context).host, "William");
  assert.deepEqual({ id: bookingMessageThread(context).id, bookingId: bookingMessageThread(context).bookingId,
    participantId: bookingMessageThread(context).participantId, host: bookingMessageThread(context).host,
    partyRole: bookingMessageThread(context).partyRole },
    { id: "db-7", bookingId: 42, participantId: "driver-1", host: "Sample Driver", partyRole: "Driver" });
});

test("listing conversation context is read-only and restricted to the booking participants", async () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_sample_only", SUPABASE_URL: "https://sample.invalid",
    SUPABASE_ANON_KEY: "sample-anon", SUPABASE_SERVICE_ROLE_KEY: "sample-service" };
  const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, env);
  let userId = "host-1";
  let exists = true;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.hostname, "sample.invalid");
    assert.equal(init.method || "GET", "GET", "Opening a conversation performs no writes");
    calls.push(url.pathname);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: userId });
    if (url.pathname === "/rest/v1/bookings") {
      return exists ? Response.json({ id: 42, listing_id: 7, renter_id: "driver-1", status: "confirmed", paid_at: "2026-10-16T09:00:00Z", stripe_checkout_session_id: "cs_paid" })
        : Response.json({ message: "not found" }, { status: 406 });
    }
    if (url.pathname === "/rest/v1/listings") return Response.json({ id: 7, host_id: "host-1", title: "Sample driveway", address: "Sample address", price: 5 });
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ id: "host-1", name: "William" }, { id: "driver-1", name: "Sample Driver" }]);
    assert.fail("Unexpected request " + url.pathname);
  };
  const response = () => ({ code: 200, body: null, status(n) { this.code = n; return this; }, json(data) { this.body = data; return this; } });
  try {
    const { default: handler } = await import("../api/messages.js");
    async function context(id = "42", signedIn = true) {
      const res = response();
      await handler({ method: "GET", url: "/api/messages", query: { contextBookingId: id },
        headers: signedIn ? { authorization: "Bearer sample-token" } : {} }, res);
      return res;
    }
    let res = await context();
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.recipient, { id: "driver-1", name: "Sample Driver", role: "Driver" });
    userId = "driver-1";
    res = await context();
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.recipient, { id: "host-1", name: "William", role: "Host" });
    userId = "outsider";
    calls.length = 0;
    res = await context();
    assert.equal(res.code, 404);
    assert.equal(res.body.listing, undefined);
    assert.equal(calls.includes("/rest/v1/profiles"), false);
    assert.equal((await context("-1")).code, 400);
    assert.equal((await context("42", false)).code, 401);
    exists = false;
    assert.equal((await context()).code, 404);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
