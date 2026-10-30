import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { canReadCancelledBookingTitle, canReadPreciseLocation, privateBookingListing } from "../src/lib/privateListingAccess.js";
import { withBookingChargeTotals } from "../api/_booking-display-total.js";

const listing = { id: 7, host_id: "H", title: "Driveway at 123 Fixture Lane", address: "123 Fixture Lane",
  lat: 43.123456, lng: -79.123456, spaces: 2, spots: [{ forRent: true, lat: 43.123456 }],
  description: "Private access instructions", img: "PRIVATE PHOTO", profiles: { name: "Private Host" } };
const booking = { id: 42, listing_id: 7, renter_id: "A", status: "refunded", application_state: "applied",
  paid_at: "2026-10-01T10:00:00Z", stripe_checkout_session_id: "cs_fixture_paid", hours: 1, total: 14.13,
  scheduled_starts_at: "2026-10-02T13:00:00Z", property_time_zone: "America/Toronto", spot_label: "A" };
const context = b => ({ userId: "A", hostId: "H", listingId: 7, booking: b });

const source = (await readFile(new URL("../api/account-bookings.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace("export default async function handler", "async function handler");
function fixture(rows = [booking], userId = "A") {
  const calls = [];
  const records = { bookings: rows, listings: [listing], profiles: [{ id: "H", name: "Private Host" }], booking_extensions: [] };
  const db = { from(table) {
    assert.ok(records[table], `Unexpected table ${table}`);
    const filters = []; let columns = null, offset = 0, max = Infinity;
    const query = {
      select(value) { columns = value.split(","); return this; },
      eq(key, value) { filters.push(row => row[key] === value); calls.push({ table, key, value }); return this; },
      in(key, values) { filters.push(row => values.includes(row[key])); return this; },
      not(key, op, value) { assert.equal(op, "is"); assert.equal(value, null); filters.push(row => row[key] != null); return this; },
      order() { return this; }, limit(value) { max = value; return this; },
      range(start, end) { offset = start; max = end - start + 1; return this; },
      then(resolve, reject) {
        const data = records[table].filter(row => filters.every(fn => fn(row))).slice(offset, offset + max)
          .map(row => Object.fromEntries(columns.map(key => [key, row[key] ?? null])));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const requireUser = async (req, res) => {
    if (userId) return { id: userId };
    res.status(401).json({ error: "Sign in is required." }); return null;
  };
  const jsonMethod = (req, res, method) => {
    if (req.method === method) return true;
    res.status(405).json({ error: "Method not allowed" }); return false;
  };
  const values = { jsonMethod, requireUser, supabaseAdmin: db, privateBookingListing, canReadPreciseLocation,
    canReadCancelledBookingTitle, withBookingChargeTotals };
  const handler = new Function(...Object.keys(values), source + ";return handler;")(...Object.values(values));
  return { calls, async get(query = {}) {
    const res = { headers: {}, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; },
      setHeader(key, value) { this.headers[key] = value; } };
    await handler({ method: "GET", query: { view: "driver", ...query } }, res);
    return res;
  } };
}

test("BUG-005485 own paid cancellations retain title without precise-location entitlement", () => {
  for (const status of ["refunded", "cancelled", "canceled"]) {
    const ctx = context({ ...booking, status });
    assert.equal(canReadCancelledBookingTitle(ctx), true, status);
    assert.equal(canReadPreciseLocation(ctx), false, status);
    const projected = privateBookingListing(listing, false, canReadCancelledBookingTitle(ctx));
    assert.equal(projected.title, listing.title);
    assert.equal(projected.address, "Address available with a confirmed booking");
    assert.equal(projected.lat, null); assert.equal(projected.lng, null);
    assert.deepEqual(projected.spots, []); assert.equal(projected.description, "");
    assert.deepEqual(projected.profiles, { name: "Host" });
    assert.equal(projected.img, undefined);
  }
});

test("BUG-005485 title access rejects outsiders, mismatched listings, unpaid and rejected records", () => {
  for (const ctx of [
    { ...context(booking), userId: "B" }, { ...context(booking), userId: null },
    { ...context(booking), listingId: 8 }, context(null),
    ...[{ paid_at: null }, { paid_at: "invalid" }, { stripe_checkout_session_id: null },
      { stripe_checkout_session_id: " " }, { application_state: "rejected" }, { status: "pending" },
      { status: "payment_failed" }].map(change => context({ ...booking, ...change })),
  ]) assert.equal(canReadCancelledBookingTitle(ctx), false);
  assert.equal(privateBookingListing(listing, false).title, "Private parking", "Other callers keep the existing default");
});

test("BUG-005485 actual account API returns only the owner's historical title and safe fields", async () => {
  const f = fixture([booking, { ...booking, id: 43, renter_id: "B" }]);
  const res = await f.get({ userId: "B" });
  assert.equal(res.code, 200); assert.equal(res.body.bookings.length, 1);
  const row = res.body.bookings[0];
  assert.equal(row.id, 42); assert.equal(row.listings.title, listing.title);
  assert.equal(row.listings.address, "Address available with a confirmed booking");
  assert.equal(row.listings.lat, null); assert.equal(row.listings.lng, null);
  assert.deepEqual(row.listings.spots, []); assert.equal(row.listings.description, "");
  assert.equal(row.listings.profiles.name, "Host");
  assert.equal(row.stripe_checkout_session_id, undefined);
  assert.equal(row.charged_total, 14.13); assert.equal(row.spot_label, "A");
  assert.equal(res.headers["Cache-Control"], "private, no-store");
  assert.ok(f.calls.some(call => call.table === "bookings" && call.key === "renter_id" && call.value === "A"));
});

test("BUG-005485 cancellation title remains identical before and after the parking date", async () => {
  for (const starts of ["2020-01-01T13:00:00Z", "2050-01-01T13:00:00Z"]) {
    const res = await fixture([{ ...booking, scheduled_starts_at: starts }]).get();
    assert.equal(res.body.bookings[0].listings.title, listing.title);
  }
});

test("BUG-005485 unpaid cancellations and pending checkouts stay generic; rejected checkouts stay excluded", async () => {
  for (const change of [{ status: "cancelled", paid_at: null }, { stripe_checkout_session_id: null }, { status: "pending" }]) {
    const res = await fixture([{ ...booking, ...change }]).get();
    assert.equal(res.body.bookings[0].listings.title, "Private parking");
  }
  const rejected = await fixture([{ ...booking, application_state: "rejected" }]).get();
  assert.deepEqual(rejected.body.bookings, []);
});

test("BUG-005485 signed-out and unrelated accounts cannot retrieve another Driver's booking", async () => {
  const signedOut = fixture([booking], null), res = await signedOut.get();
  assert.equal(res.code, 401); assert.equal(signedOut.calls.length, 0);
  const other = await fixture([booking], "B").get();
  assert.equal(other.code, 200); assert.deepEqual(other.body.bookings, []);
});

test("BUG-005485 missing listing data does not crash or fabricate a historical title", async () => {
  const res = await fixture([{ ...booking, listing_id: 999 }]).get();
  assert.equal(res.code, 200); assert.equal(res.body.bookings[0].listings.title, "Private parking");
});
