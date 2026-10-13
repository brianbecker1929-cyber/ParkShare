import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, describe, test } from "node:test";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const fixtureUrl = new URL("./booking-holds-fixture.sql", import.meta.url);
const holdsMigrationUrl = new URL("../../supabase-migration-005-booking-holds.sql", import.meta.url);
const deletionMigrationUrl = new URL("../../supabase-migration-010-preserve-bookings-on-listing-delete.sql", import.meta.url);

const HOST_ID = "00000000-0000-4000-8000-000000000041";
const RENTER_ID = "00000000-0000-4000-8000-000000000042";

describe("listing deletion preserves financial records", { skip: !databaseUrl, concurrency: 1 }, () => {
  let pool;
  let listingId;

  before(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000, max: 3 });
    for (const file of [fixtureUrl, holdsMigrationUrl, deletionMigrationUrl]) {
      await pool.query(await readFile(file, "utf8"));
    }
  });

  beforeEach(async () => {
    await pool.query(
      `truncate table public.booking_holds, public.bookings, public.listings,
       public.profiles, auth.users restart identity cascade`
    );
    await pool.query(`insert into auth.users (id) values ($1), ($2)`, [HOST_ID, RENTER_ID]);
    await pool.query(`insert into public.profiles (id) values ($1), ($2)`, [HOST_ID, RENTER_ID]);
    const result = await pool.query(
      `insert into public.listings (host_id, spaces) values ($1, 1) returning id`,
      [HOST_ID]
    );
    listingId = result.rows[0].id;
  });

  after(async () => {
    await pool?.end();
  });

  test("a future paid booking blocks listing deletion without deleting its payment record", async () => {
    const inserted = await pool.query(
      `insert into public.bookings
       (listing_id, renter_id, status, session_range, stripe_payment_intent_id, paid_at)
       values ($1, $2, 'confirmed',
         tstzrange(now() + interval '1 day', now() + interval '1 day 1 hour', '[)'),
         'pi_protected', now()) returning id`,
      [listingId, RENTER_ID]
    );
    await assert.rejects(
      pool.query(`delete from public.listings where id = $1`, [listingId]),
      error => error.code === "23503"
    );
    const booking = await pool.query(
      `select id, status, stripe_payment_intent_id from public.bookings where id = $1`,
      [inserted.rows[0].id]
    );
    assert.deepEqual(booking.rows, [{
      id: inserted.rows[0].id, status: "confirmed", stripe_payment_intent_id: "pi_protected",
    }]);
  });

  test("historical refunded bookings still prevent destructive deletion", async () => {
    await pool.query(
      `insert into public.bookings
       (listing_id, renter_id, status, session_range, stripe_payment_intent_id, paid_at)
       values ($1, $2, 'refunded',
         tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '1 hour', '[)'),
         'pi_historical', now() - interval '3 days')`,
      [listingId, RENTER_ID]
    );
    await assert.rejects(
      pool.query(`delete from public.listings where id = $1`, [listingId]),
      error => error.code === "23503"
    );
    const result = await pool.query(`select count(*)::integer as count from public.bookings where listing_id = $1`, [listingId]);
    assert.equal(result.rows[0].count, 1);
  });

  test("an in-flight checkout hold blocks listing deletion", async () => {
    await pool.query(
      `insert into public.booking_holds
       (listing_id, renter_id, starts_at, ends_at, expires_at)
       values ($1, $2, now() + interval '1 hour', now() + interval '2 hours', now() + interval '15 minutes')`,
      [listingId, RENTER_ID]
    );
    await assert.rejects(
      pool.query(`delete from public.listings where id = $1`, [listingId]),
      error => error.code === "23503"
    );
    const hold = await pool.query(`select count(*)::integer as count from public.booking_holds where listing_id = $1`, [listingId]);
    assert.equal(hold.rows[0].count, 1);
  });

  test("an unused listing can still be deleted normally", async () => {
    const removed = await pool.query(`delete from public.listings where id = $1 returning id`, [listingId]);
    assert.equal(removed.rowCount, 1);
    const afterRemoval = await pool.query(`select count(*)::integer as count from public.listings where id = $1`, [listingId]);
    assert.equal(afterRemoval.rows[0].count, 0);
  });
});
