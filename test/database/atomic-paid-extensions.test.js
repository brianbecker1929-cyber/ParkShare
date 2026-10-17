import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const HOST = "00000000-0000-4000-8000-0000000000a1";
const RENTER = "00000000-0000-4000-8000-0000000000a2";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const setupSchema = String.raw`
CREATE TABLE public.booking_extensions (
 id bigint generated always as identity primary key,
 booking_id bigint not null references public.bookings(id) on delete cascade,
 added_hours numeric not null check (added_hours > 0),
 added_amount numeric not null check (added_amount >= 0),
 stripe_checkout_session_id text unique,
 stripe_payment_intent_id text, stripe_charge_id text,
 stripe_connected_account_id text, status text not null,
 paid_at timestamptz, created_at timestamptz not null default now()
);
CREATE OR REPLACE FUNCTION public.test_recompute_session_range()
RETURNS trigger LANGUAGE plpgsql AS $trigger$
BEGIN
 IF new.hours IS DISTINCT FROM old.hours THEN
   new.session_range := tstzrange(lower(old.session_range),
     lower(old.session_range) + (new.hours::text || ' hours')::interval, '[)');
 END IF;
 RETURN new;
END; $trigger$;
CREATE TRIGGER bookings_test_session_range BEFORE UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.test_recompute_session_range();
`.replace(/\\`/g,"`");

describe("atomic paid extension database proposal (disposable PostgreSQL only)", { skip: !databaseUrl, concurrency: 1 }, () => {
  let pool;
  let bookingId;
  let listingId;

  before(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 6 });
    const files = [
      "../booking-holds-fixture.sql",
      "../../../supabase-migration-005-booking-holds.sql",
      "../../../supabase-migration-011-registered-checkouts.sql",
    ];
    for (const file of files) await pool.query(await read(file));
    await pool.query(setupSchema);
    await pool.query(await read("../../../docs/sql-proposals/qa-atomic-extensions-and-refunds.sql"));
  });

  beforeEach(async () => {
    await pool.query(`truncate public.booking_extensions, public.pending_booking_extensions,
      public.booking_holds, public.bookings, public.listings,
      public.profiles, auth.users restart identity cascade`);
    await pool.query("insert into auth.users(id) values ($1),($2)", [HOST, RENTER]);
    await pool.query("insert into public.profiles(id) values ($1),($2)", [HOST, RENTER]);
    const listing = await pool.query(
      "insert into public.listings(host_id,spaces) values ($1,1) returning id", [HOST]);
    listingId = listing.rows[0].id;
    const booking = await pool.query(`insert into public.bookings
      (listing_id,renter_id,hours,status,spot_label,paid_at,session_range,stripe_connected_account_id)
      values ($1,$2,1,'confirmed','A',now()-interval '30 minutes',
      tstzrange(now()-interval '30 minutes',now()+interval '30 minutes','[)'),'acct_test')
      returning id`, [listingId, RENTER]);
    bookingId = booking.rows[0].id;
  });

  after(async () => { await pool?.end(); });

  async function register(session, hours = 1, total = 115) {
    await pool.query(`insert into public.pending_booking_extensions
      (booking_id,renter_id,added_hours,expected_total_cents,expected_service_fee_cents,
       expected_connected_account_id,stripe_checkout_session_id)
      values ($1,$2,$3,$4,15,'acct_test',$5)`,
      [bookingId, RENTER, hours, total, session]);
  }

  function apply(session, hours = 1, total = 115) {
    return pool.query(`select * from public.apply_paid_booking_extension(
      $1::text,$2::bigint,$3::uuid,$4::numeric,$5::integer,
      $6::text,$7::text,$8::text,now())`,
      [session, bookingId, RENTER, hours, total, "pi_"+session,
       "ch_"+session, "acct_test"]);
  }

  async function state() {
    const { rows: booking } = await pool.query(
      "select hours, upper(session_range) as ends_at from public.bookings where id=$1", [bookingId]);
    const { rows: extension } = await pool.query(
      "select stripe_checkout_session_id from public.booking_extensions order by id");
    return { hours: Number(booking[0].hours), end: new Date(booking[0].ends_at).getTime(),
      sessions: extension.map(x=>x.stripe_checkout_session_id) };
  }

  test("one payment increases booking hours and is idempotent on Stripe replay", async () => {
    await register("cs_one");
    const before = await state();
    const first = await apply("cs_one");
    assert.equal(first.rows[0].applied, true);
    const after = await state();
    assert.equal(after.hours, 2);
    assert.equal(after.end-before.end, 3_600_000);
    assert.deepEqual(after.sessions, ["cs_one"]);
    const again = await apply("cs_one");
    assert.equal(again.rows[0].applied, false);
    assert.deepEqual(await state(), after);
  });

  test("wrong Checkout total rejects payment and leaves both rows unchanged", async () => {
    await register("cs_bad_total");
    await assert.rejects(apply("cs_bad_total",1,500), error => error.code==="22023");
    const stateAfter = await state();
    assert.equal(stateAfter.hours,1);
    assert.deepEqual(stateAfter.sessions,[]);
  });

  test("conflicting held space rejects paid extension without overbooking", async () => {
    await register("cs_held");
    await pool.query(`insert into public.booking_holds
      (listing_id,renter_id,spot_label,starts_at,ends_at,expires_at)
      values ($1,$2,'A',now()+interval '30 minutes',now()+interval '90 minutes',
      now()+interval '10 minutes')`,[listingId,RENTER]);
    await assert.rejects(apply("cs_held"), error => error.code==="P0001");
    assert.equal((await state()).hours,1);
    assert.deepEqual((await state()).sessions,[]);
  });

  test("two simultaneous paid extensions serialize without lost duration", async () => {
    await register("cs_parallel_a");
    await register("cs_parallel_b");
    const [a,b] = await Promise.all([
      apply("cs_parallel_a"),
      apply("cs_parallel_b"),
    ]);
    assert.equal(a.rows[0].applied,true);
    assert.equal(b.rows[0].applied,true);
    const after=await state();
    assert.equal(after.hours,3);
    assert.deepEqual(after.sessions,["cs_parallel_a","cs_parallel_b"]);
  });

  test("database failure updating booking rolls back the extension insert", async () => {
    await register("cs_rollback");
    await pool.query("alter table public.bookings add constraint test_block_extended_hours check (hours <= 1)");
    try {
      await assert.rejects(apply("cs_rollback"), error => error.code==="23514");
      const after=await state();
      assert.equal(after.hours,1);
      assert.deepEqual(after.sessions,[]);
    } finally {
      await pool.query("alter table public.bookings drop constraint test_block_extended_hours");
    }
  });

  test("function denies anon and authenticated and grants service_role", async () => {
    const signature="public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz)";
    const { rows } = await pool.query(
      "select has_function_privilege('anon',$1,'EXECUTE') as anon, "+
      "has_function_privilege('authenticated',$1,'EXECUTE') as authenticated, "+
      "has_function_privilege('service_role',$1,'EXECUTE') as service",
      [signature]);
    assert.deepEqual(rows[0],{anon:false,authenticated:false,service:true});
  });
});
