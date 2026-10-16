import test from "node:test";
import assert from "node:assert/strict";
import { deleteHostListing, listingDeletionFailureMessage } from "../src/lib/listingDeletion.js";

const HOST = "00000000-0000-4000-8000-000000000041";

function fakeClient(response, { throwRequest = false } = {}) {
  const trace = [];
  const from = table => {
    trace.push(["from", table]);
    return {
      delete() {
        trace.push(["delete"]);
        return {
          eq(field, value) {
            trace.push(["eq", field, value]);
            return this;
          },
          select(field) {
            trace.push(["select", field]);
            if (throwRequest) throw new Error("Unavailable");
            return Promise.resolve(response);
          },
        };
      },
    };
  };
  return { from, trace };
}

test("an unused listing deletes without ever querying bookings/count", async () => {
  const db = fakeClient({ data: [{ id: 52 }], error: null });
  const result = await deleteHostListing(db, { listingId: 52, hostId: HOST });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(db.trace, [
    ["from", "listings"], ["delete"],
    ["eq", "id", 52], ["eq", "host_id", HOST], ["select", "id"],
  ]);
});

test("protected paid or refunded booking raises FK error; no listing is reported deleted", async () => {
  const db = fakeClient({ data: null, error: { code: "23503", message: "foreign_key_violation" } });
  const result = await deleteHostListing(db, { listingId: 7, hostId: HOST });
  assert.equal(result.ok, false);
  assert.match(result.message, /bookings or checkout reservations/);
  assert.match(result.message, /No reservation was removed/);
});

test("RLS-denied/no-row deletes must not display a success message", async () => {
  const db = fakeClient({ data: [], error: null });
  const result = await deleteHostListing(db, { listingId: 42, hostId: HOST });
  assert.equal(result.ok, false);
  assert.match(result.message, /not deleted/);
});

test("transient Supabase outages are caught without further database mutations", async () => {
  const db = fakeClient(null, { throwRequest: true });
  const result = await deleteHostListing(db, { listingId: 42, hostId: HOST });
  assert.equal(result.ok, false);
  assert.match(result.message, /Unable to reach the database/);
  assert.equal(db.trace.filter(([op]) => op === "delete").length, 1);
});

test("invalid and unauthenticated deletion requests make no database call", async () => {
  const db = fakeClient({ data: [{ id: 1 }], error: null });
  const result = await deleteHostListing(db, { listingId: 1, hostId: null });
  assert.equal(result.ok, false);
  assert.equal(db.trace.length, 0);
  assert.match(listingDeletionFailureMessage({code:"42501"}), /not authorized/);
});
