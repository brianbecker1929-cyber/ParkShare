import test, { before, beforeEach, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const files = [
  new URL("./booking-holds-fixture.sql", import.meta.url),
  new URL("../../supabase-migration-005-booking-holds.sql", import.meta.url),
  new URL("../../supabase-migration-011-registered-checkouts.sql", import.meta.url),
];
const HOST_ID = "00000000-0000-4000-8000-000000000091";
const RENTER_ID = "00000000-0000-4000-8000-000000000092";

describe("registered checkout database constraints", { skip: !databaseUrl, concurrency: 1 }, () => {
  let pool;
  let listingId;
  let bookingId;

  before(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 3 });
    for (const file of files) await pool.query(await readFile(file, "utf8"));
  });

  beforeEach(async () => {
    await pool.query("truncate public.pending_booking_extensions, public.booking_holds, public.bookings, public.listings, public.profiles, auth.users restart identity cascade");
    await pool.query("insert into auth.users (id) values ($1), ($2)", [HOST_ID, RENTER_ID]);
    await pool.query("insert into public.profiles (id) values ($1), ($2)", [HOST_ID, RENTER_ID]);
    const listing = await pool.query("insert into public.listings(host_id,spaces) values ($1,1) returning id", [HOST_ID]);
    listingId = listing.rows[0].id;
    const booking = await pool.query(`insert into public.bookings
      (listing_id, renter_id, status, session_range, stripe_payment_intent_id, paid_at)
      values ($1, $2, 'confirmed', tstzrange(now() - interval '1 hour', now() + interval '1 hour', '[)'), 'pi_existing', now())
      returning id`, [listingId, RENTER_ID]);
    bookingId = booking.rows[0].id;
  });

  after(async () => { await pool?.end(); });

  test("a trusted hold registers its Checkout Session and expected amount", async () => {
    const row = await pool.query(`insert into public.booking_holds
      (listing_id, renter_id, starts_at, ends_at, expires_at,
       stripe_checkout_session_id, expected_total_cents, expected_connected_account_id, checkout_metadata)
      values ($1, $2, now()+interval '1 day', now()+interval '1 day 1 hour', now()+interval '15 minutes',
              'cs_test_trusted', 1150, 'acct_valid', '{"hours":"1","total_cents":"1150"}')
      returning stripe_checkout_session_id, expected_total_cents, expected_connected_account_id`,[listingId, RENTER_ID]);
    assert.deepEqual(row.rows[0], {
      stripe_checkout_session_id:"cs_test_trusted",expected_total_cents:1150, expected_connected_account_id:"acct_valid",
    });
    await assert.rejects(
      pool.query(`insert into public.booking_holds
        (listing_id,renter_id,starts_at,ends_at,expires_at,stripe_checkout_session_id,expected_total_cents)
        values ($1,$2,now()+interval '2 days',now()+interval '2 days 1 hour',now()+interval '15 minutes','cs_test_trusted',1150)`, [listingId, RENTER_ID]),
      error => error.code === "23505"
    );
  });

  test("a pending extension is tied to exactly one paid Checkout Session", async () => {
    await pool.query(`insert into public.pending_booking_extensions
      (booking_id,renter_id,added_hours,expected_total_cents,expected_service_fee_cents,expected_connected_account_id,stripe_checkout_session_id)
      values ($1,$2,1,575,75,'acct_valid','cs_ext_valid')`,[bookingId, RENTER_ID]);
    await assert.rejects(
      pool.query(`insert into public.pending_booking_extensions
       (booking_id,renter_id,added_hours,expected_total_cents,expected_service_fee_cents,expected_connected_account_id,stripe_checkout_session_id)
       values ($1,$2,2,575,75,'acct_valid','cs_ext_valid')`, [bookingId, RENTER_ID]),
      e => e.code === "23505"
    );
    await assert.rejects(
      pool.query(`insert into public.pending_booking_extensions
       (booking_id,renter_id,added_hours,expected_total_cents,expected_service_fee_cents,expected_connected_account_id,stripe_checkout_session_id)
       values ($1,$2,1,10,2,'acct_valid','cs_ext_low')`, [bookingId, RENTER_ID]),
      e => e.code === "23514"
    );
  });
});
