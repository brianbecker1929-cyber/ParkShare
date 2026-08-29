import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";

import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const fixtureUrl = new URL("./booking-holds-fixture.sql", import.meta.url);
const migrationUrl = new URL("../../supabase-migration-006-cancellations-refunds.sql", import.meta.url);

const HOST_ID = "00000000-0000-4000-8000-000000000021";
const RENTER_ID = "00000000-0000-4000-8000-000000000022";

describe("cancellation and refund database constraints", { skip: !databaseUrl, concurrency: 1 }, () => {
  let pool;
  let bookingId;

  before(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000, max: 3 });
    await pool.query(await readFile(fixtureUrl, "utf8"));
    await pool.query(await readFile(migrationUrl, "utf8"));
  });

  beforeEach(async () => {
    await pool.query(
      `truncate table public.bookings, public.listings, public.profiles,
         auth.users restart identity cascade`
    );
    await pool.query(`insert into auth.users (id) values ($1), ($2)`, [HOST_ID, RENTER_ID]);
    await pool.query(`insert into public.profiles (id) values ($1), ($2)`, [HOST_ID, RENTER_ID]);
    const { rows: listings } = await pool.query(
      `insert into public.listings (host_id, spaces) values ($1, 1) returning id`,
      [HOST_ID]
    );
    const { rows: bookings } = await pool.query(
      `insert into public.bookings
         (listing_id, renter_id, status, session_range, stripe_payment_intent_id, paid_at)
       values ($1, $2, 'confirmed', tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour', '[)'),
               'pi_cancel', now())
       returning id`,
      [listings[0].id, RENTER_ID]
    );
    bookingId = bookings[0].id;
  });

  after(async () => {
    await pool?.end();
  });

  test("a cancellation records the actor and Stripe refund lifecycle", async () => {
    const { rows } = await pool.query(
      `update public.bookings
          set cancellation_requested_at = now(),
              cancelled_at = now(),
              cancelled_by = 'driver',
              cancellation_reason = 'Plans changed',
              stripe_refund_id = 're_cancel',
              refund_amount = 287.50,
              refund_status = 'succeeded',
              status = 'refunded'
        where id = $1
        returning status, cancelled_by, stripe_refund_id, refund_status, refund_amount::text`,
      [bookingId]
    );
    assert.deepEqual(rows, [{
      status: "refunded",
      cancelled_by: "driver",
      stripe_refund_id: "re_cancel",
      refund_status: "succeeded",
      refund_amount: "287.50",
    }]);
  });

  test("unknown cancellation actors and refund states are rejected", async () => {
    await assert.rejects(
      pool.query(`update public.bookings set cancelled_by = 'stranger' where id = $1`, [bookingId]),
      (error) => error.code === "23514"
    );
    await assert.rejects(
      pool.query(`update public.bookings set refund_status = 'unknown' where id = $1`, [bookingId]),
      (error) => error.code === "23514"
    );
  });

  test("one Stripe refund cannot be attached to two bookings", async () => {
    await pool.query(`update public.bookings set stripe_refund_id = 're_unique' where id = $1`, [bookingId]);
    await assert.rejects(
      pool.query(
        `insert into public.bookings
           (listing_id, renter_id, status, session_range, stripe_payment_intent_id, stripe_refund_id, paid_at)
         select listing_id, renter_id, 'confirmed',
                tstzrange(now() + interval '2 days', now() + interval '2 days 1 hour', '[)'),
                'pi_other', 're_unique', now()
           from public.bookings where id = $1`,
        [bookingId]
      ),
      (error) => error.code === "23505"
    );
  });
});
