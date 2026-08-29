import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";

import pg from "pg";

import { disputeReconciliation, refundReconciliation } from "../../api/_refund-rules.js";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const fixtureUrl = new URL("./booking-holds-fixture.sql", import.meta.url);

const HOST_ID = "00000000-0000-4000-8000-000000000011";
const RENTER_ID = "00000000-0000-4000-8000-000000000012";

describe("refund and dispute database reconciliation", { skip: !databaseUrl, concurrency: 1 }, () => {
  let pool;
  let bookingId;

  before(async () => {
    pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5_000,
      max: 3,
    });
    await pool.query(await readFile(fixtureUrl, "utf8"));
  });

  beforeEach(async () => {
    await pool.query(
      `truncate table public.bookings, public.listings, public.profiles,
         auth.users restart identity cascade`
    );
    await pool.query(`insert into auth.users (id) values ($1), ($2)`, [HOST_ID, RENTER_ID]);
    await pool.query(`insert into public.profiles (id) values ($1), ($2)`, [HOST_ID, RENTER_ID]);

    const { rows: listingRows } = await pool.query(
      `insert into public.listings (host_id, spaces) values ($1, 1) returning id`,
      [HOST_ID]
    );
    const { rows: bookingRows } = await pool.query(
      `insert into public.bookings
         (listing_id, renter_id, status, session_range, stripe_checkout_session_id,
          stripe_payment_intent_id, stripe_charge_id, paid_at)
       values ($1, $2, 'confirmed', tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour', '[)'),
               'cs_test_refund', 'pi_refund', 'ch_refund', now())
       returning id`,
      [listingRows[0].id, RENTER_ID]
    );
    bookingId = bookingRows[0].id;
  });

  after(async () => {
    await pool?.end();
  });

  async function applyRefund(charge) {
    const reconciliation = refundReconciliation(charge);
    if (!reconciliation) return [];
    const { rows } = await pool.query(
      `update public.bookings
          set status = $1
        where stripe_payment_intent_id = $2
        returning id, status`,
      [reconciliation.status, reconciliation.paymentIntentId]
    );
    return rows;
  }

  async function applyDispute(dispute) {
    const reconciliation = disputeReconciliation(dispute);
    if (!reconciliation) return [];
    const { rows } = await pool.query(
      `update public.bookings
          set status = $1
        where stripe_charge_id = $2
        returning id, status`,
      [reconciliation.status, reconciliation.chargeId]
    );
    return rows;
  }

  test("partial and then full refund events advance one booking deterministically", async () => {
    assert.deepEqual(await applyRefund({ payment_intent: "pi_refund", refunded: false }), [
      { id: bookingId, status: "partially_refunded" },
    ]);
    assert.deepEqual(await applyRefund({ payment_intent: { id: "pi_refund" }, refunded: true }), [
      { id: bookingId, status: "refunded" },
    ]);
  });

  test("replaying the same full-refund event is idempotent", async () => {
    await applyRefund({ payment_intent: "pi_refund", refunded: true });
    await applyRefund({ payment_intent: "pi_refund", refunded: true });

    const { rows } = await pool.query(
      `select count(*)::integer as count, min(status) as status
         from public.bookings
        where stripe_payment_intent_id = 'pi_refund'`
    );
    assert.deepEqual(rows, [{ count: 1, status: "refunded" }]);
  });

  test("an unrelated payment intent cannot change another booking", async () => {
    assert.deepEqual(await applyRefund({ payment_intent: "pi_other", refunded: true }), []);
    const { rows } = await pool.query(`select status from public.bookings where id = $1`, [bookingId]);
    assert.deepEqual(rows, [{ status: "confirmed" }]);
  });

  test("a dispute is idempotently linked by Stripe charge id", async () => {
    assert.deepEqual(await applyDispute({ charge: "ch_refund" }), [{ id: bookingId, status: "disputed" }]);
    assert.deepEqual(await applyDispute({ charge: { id: "ch_refund" } }), [{ id: bookingId, status: "disputed" }]);
  });

  test("the schema rejects unknown financial states", async () => {
    await assert.rejects(
      pool.query(`update public.bookings set status = 'refund_pending' where id = $1`, [bookingId]),
      (error) => error.code === "23514"
    );
  });
});
