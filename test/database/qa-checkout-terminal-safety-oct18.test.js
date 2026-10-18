// Disposable PostgreSQL only; setup deliberately DROPS the public/auth schemas.
// The CI TEST_DATABASE_URL must never target ParkShare QA or production.
import assert from "node:assert/strict";
import { before, after, beforeEach, describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const db = process.env.TEST_DATABASE_URL;
const HOST="00000000-0000-4000-8000-000000000a91";
const RENTER="00000000-0000-4000-8000-000000000a92";
const read = path => readFile(new URL(path,import.meta.url), "utf8");

describe("signed Stripe terminal event database predicates (disposable PostgreSQL)", {
  skip: !db, concurrency:1,
},()=>{
  let pool, listing, booking;
  before(async()=>{
    pool = new Pool({connectionString:db,connectionTimeoutMillis:5000,max:2});
    await pool.query(await read("./booking-holds-fixture.sql"));
    await pool.query(await read("../../supabase-migration-005-booking-holds.sql"));
    await pool.query(await read("../../supabase-migration-011-registered-checkouts.sql"));
  });
  after(async()=>{await pool?.end();});
  beforeEach(async()=>{
    await pool.query("truncate public.pending_booking_extensions, public.booking_holds, public.bookings, public.listings, public.profiles, auth.users restart identity cascade");
    await pool.query("insert into auth.users(id) values($1),($2)",[HOST,RENTER]);
    await pool.query("insert into public.profiles(id) values($1),($2)",[HOST,RENTER]);
    listing=(await pool.query("insert into public.listings(host_id,spaces) values($1,1) returning id",[HOST])).rows[0].id;
    booking=(await pool.query(
      "insert into public.bookings(listing_id,renter_id,status,hours,session_range,stripe_checkout_session_id,stripe_connected_account_id,paid_at) values($1,$2,'confirmed',1,tstzrange(now(),now()+interval '1 hour','[)'),'cs_test_paid','acct_owner',now()) returning id",[listing,RENTER]
    )).rows[0].id;
  });

  test("late failed-payment notification cannot overwrite a paid confirmed booking",async()=>{
    const x=await pool.query(
      "update public.bookings set status='payment_failed' where stripe_checkout_session_id=$1 and stripe_connected_account_id=$2 and status='pending' and paid_at is null returning id",
      ["cs_test_paid","acct_owner"]);
    assert.equal(x.rowCount,0);
    const c=await pool.query("select status,paid_at from public.bookings where id=$1",[booking]);
    assert.equal(c.rows[0].status,"confirmed");
    assert.ok(c.rows[0].paid_at);
  });

  test("late failed-payment notification cannot overwrite a refunded/paid booking",async()=>{
    await pool.query("update public.bookings set status='refunded' where id=$1",[booking]);
    const x=await pool.query(
      "update public.bookings set status='payment_failed' where stripe_checkout_session_id=$1 and stripe_connected_account_id=$2 and status='pending' and paid_at is null returning id",
      ["cs_test_paid","acct_owner"]);
    assert.equal(x.rowCount,0);
    assert.equal((await pool.query("select status from public.bookings where id=$1",[booking])).rows[0].status,"refunded");
  });

  test("only an unpaid pending booking from the matching connected account may fail",async()=>{
    const x=await pool.query(
      "insert into public.bookings(listing_id,renter_id,status,hours,session_range,stripe_checkout_session_id,stripe_connected_account_id,paid_at) values($1,$2,'pending',1,tstzrange(now()+interval '2 hours',now()+interval '3 hours','[)'),'cs_test_unpaid','acct_owner',null) returning id",
      [listing,RENTER]);
    const wrong=await pool.query(
      "update public.bookings set status='payment_failed' where id=$1 and stripe_checkout_session_id=$2 and stripe_connected_account_id=$3 and status='pending' and paid_at is null",
      [x.rows[0].id,"cs_test_unpaid","acct_wrong"]);
    assert.equal(wrong.rowCount,0);
    const valid=await pool.query(
      "update public.bookings set status='payment_failed' where id=$1 and stripe_checkout_session_id=$2 and stripe_connected_account_id=$3 and status='pending' and paid_at is null",
      [x.rows[0].id,"cs_test_unpaid","acct_owner"]);
    assert.equal(valid.rowCount,1);
  });

  test("checkout hold deletes only under the registered account, not the signed event of another Host",async()=>{
    const hold=(await pool.query(
      "insert into public.booking_holds(listing_id,renter_id,starts_at,ends_at,expires_at,stripe_checkout_session_id,expected_connected_account_id,expected_total_cents) values($1,$2,now()+interval '2 hours',now()+interval '3 hours',now()+interval '30 minutes','cs_test_hold','acct_owner',1150) returning id",
      [listing,RENTER]
    )).rows[0].id;
    const wrong=await pool.query(
      "delete from public.booking_holds where id=$1 and stripe_checkout_session_id='cs_test_hold' and expected_connected_account_id=$2",
      [hold,"acct_wrong"]);
    assert.equal(wrong.rowCount,0);
    assert.equal((await pool.query("select count(*)::int as n from public.booking_holds where id=$1",[hold])).rows[0].n,1);
    const valid=await pool.query(
      "delete from public.booking_holds where id=$1 and stripe_checkout_session_id='cs_test_hold' and expected_connected_account_id=$2",
      [hold,"acct_owner"]);
    assert.equal(valid.rowCount,1);
  });

  test("extension pending registration remains protected from unrelated connected accounts",async()=>{
    const pending=(await pool.query(
      "insert into public.pending_booking_extensions(booking_id,renter_id,added_hours,expected_total_cents,expected_service_fee_cents,expected_connected_account_id,stripe_checkout_session_id) values($1,$2,1,115,15,'acct_owner','cs_test_ext') returning id",
      [booking,RENTER]
    )).rows[0].id;
    const wrong=await pool.query(
      "delete from public.pending_booking_extensions where id=$1 and stripe_checkout_session_id='cs_test_ext' and expected_connected_account_id='acct_wrong'",
      [pending]);
    assert.equal(wrong.rowCount,0);
    const valid=await pool.query(
      "delete from public.pending_booking_extensions where id=$1 and stripe_checkout_session_id='cs_test_ext' and expected_connected_account_id='acct_owner'",
      [pending]);
    assert.equal(valid.rowCount,1);
  });
});
