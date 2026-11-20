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
`;

describe("atomic paid extension database proposal (disposable PostgreSQL only)", { skip: !databaseUrl, concurrency: 1 }, () => {
  let pool;
  let bookingId;
  let listingId;

  before(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 6 });
    const files = [
      "./booking-holds-fixture.sql",
      "../../supabase-migration-005-booking-holds.sql",
      "../../supabase-migration-011-registered-checkouts.sql",
    ];
    for (const file of files) await pool.query(await read(file));
    await pool.query(setupSchema);
    await pool.query(await read("../../docs/sql-proposals/qa-atomic-extensions-and-refunds.sql"));
    await pool.query(await read("../../supabase/migrations/20261020205407_extension_settlement_005116_005260.sql"));
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
    // Same service-role RPC used by create-extend-session. It reserves
    // the precise PostgreSQL session_range endpoint without JS ms truncation.
    const { rows: hold } = await pool.query(
      "select * from public.reserve_extension_checkout_hold($1,$2,$3,$4)",
      [bookingId, RENTER, hours,
       new Date(Date.now() + 30 * 60 * 1000).toISOString()]);
    const holdId = hold[0].hold_id;
    await pool.query("update public.booking_holds set stripe_checkout_session_id=$2 where id=$1", [holdId, session]);
    await pool.query(`insert into public.pending_booking_extensions
      (booking_id,renter_id,added_hours,expected_total_cents,expected_service_fee_cents,
       expected_connected_account_id,stripe_checkout_session_id,hold_id)
      values ($1,$2,$3,$4,15,'acct_test',$5,$6)`,
      [bookingId, RENTER, hours, total, session, holdId]);
    return holdId;
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

  test("extension reservation obtains Driver quota lock before listing lock, matching hold RPC", async () => {
    const { rows } = await pool.query(
      "select pg_get_functiondef('public.reserve_extension_checkout_hold(bigint,uuid,numeric,timestamptz)'::regprocedure) as source");
    const source = rows[0].source;
    const driverLock = source.indexOf("PERFORM pg_catalog.pg_advisory_xact_lock(5118, hashtext(p_renter_id::text))");
    const listingLock = source.indexOf("PERFORM pg_catalog.pg_advisory_xact_lock(v_listing_id)");
    const nestedHold = source.indexOf("RETURN QUERY SELECT public.create_booking_hold(");
    assert.ok(driverLock >= 0 && listingLock > driverLock && nestedHold > listingLock,
      "must take Driver quota lock BEFORE listing lock BEFORE calling shared booking hold function");
  });

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

  test("a second concurrent checkout for the same spot/time is denied BEFORE payment", async () => {
    await register("cs_parallel_a");
    await assert.rejects(register("cs_parallel_b"), error => error.code === "P0001");
    assert.equal((await state()).hours, 1);
    assert.equal((await pool.query("select count(*)::int as n from public.pending_booking_extensions")).rows[0].n, 1);
    const result = await apply("cs_parallel_a");
    assert.equal(result.rows[0].applied, true);
    assert.equal((await state()).hours, 2);
  });

  test("concurrent duplicate webhook deliveries are idempotent", async () => {
    await register("cs_parallel_webhook");
    const results = await Promise.all([
      apply("cs_parallel_webhook"), apply("cs_parallel_webhook"),
    ]);
    assert.deepEqual(results.map(x=>x.rows[0].applied).sort(), [false,true]);
    assert.equal((await state()).hours, 2);
    assert.deepEqual((await state()).sessions, ["cs_parallel_webhook"]);
  });

  test("sequential checkouts safely extend the NEW booked endpoint", async () => {
    await register("cs_first");
    await apply("cs_first");
    await register("cs_second");
    await apply("cs_second");
    assert.equal((await state()).hours, 3);
    assert.deepEqual((await state()).sessions, ["cs_first","cs_second"]);
  });

  test("paid webhook refuses a forged or missing registered hold", async () => {
    const originalHold = await register("cs_missing_hold");
    await pool.query("update public.pending_booking_extensions set hold_id=null where stripe_checkout_session_id='cs_missing_hold'");
    await assert.rejects(apply("cs_missing_hold"), error => error.code==="22023");
    assert.equal((await state()).hours, 1);

    await pool.query("update public.pending_booking_extensions set hold_id=$1 where stripe_checkout_session_id='cs_missing_hold'", [originalHold]);
    await pool.query("update public.booking_holds set stripe_checkout_session_id='cs_different' where id=$1", [originalHold]);
    await assert.rejects(apply("cs_missing_hold"), error => error.code==="22023");
    assert.equal((await state()).hours, 1);
    assert.deepEqual((await state()).sessions, []);
  });

  test("application releases its OWN hold atomically and keeps new booked time", async () => {
    const id = await register("cs_release");
    assert.equal((await pool.query("select count(*)::int as n from public.booking_holds where id=$1",[id])).rows[0].n, 1);
    await apply("cs_release");
    assert.equal((await pool.query("select count(*)::int as n from public.booking_holds where id=$1",[id])).rows[0].n, 0);
    assert.equal((await state()).hours, 2);
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
  function rejectPayment(session, account="acct_test") {
    return pool.query("select public.record_rejected_booking_extension($1,$2,$3,$4,115,now()) id",
      [session,"pi_"+session,"ch_"+session,account]);
  }
  test("rejected payment journals once, releases occupancy, never adds hours, and permits same +1h retry",async()=>{
    await register("cs_rejected");
    const first=await rejectPayment("cs_rejected");
    assert.equal((await rejectPayment("cs_rejected")).rows[0].id,first.rows[0].id);
    assert.equal((await state()).hours,1);
    assert.equal((await pool.query("select count(*)::int n from public.booking_holds")).rows[0].n,0);
    assert.equal((await pool.query("select application_state from public.booking_extensions")).rows[0].application_state,'rejected');
    assert.equal((await apply("cs_rejected")).rows[0].applied,false);
    await register("cs_retry");await apply("cs_retry");assert.equal((await state()).hours,2);
  });
  test("applied extensions cannot become rejected or be automatically refunded",async()=>{
    await register("cs_applied");await apply("cs_applied");
    await assert.rejects(rejectPayment("cs_applied"),e=>e.code==='22023');
    assert.equal((await state()).hours,2);
  });
  test("concurrent application and rejection serialize into exactly one entitlement decision",async()=>{
    await register("cs_race");
    const result=await Promise.allSettled([apply("cs_race"),rejectPayment("cs_race")]);
    const row=(await pool.query("select application_state from public.booking_extensions")).rows[0];
    if(row.application_state==='applied'){
      assert.equal((await state()).hours,2);assert.equal(result[1].status,'rejected');
    }else{
      assert.equal((await state()).hours,1);assert.equal(result[0].value.rows[0].applied,false);
    }
    assert.equal((await pool.query("select count(*)::int n from public.booking_extensions")).rows[0].n,1);
  });
  test("wrong account or hold identity rejects cleanup and rolls financial audit back",async()=>{
    const hold=await register("cs_foreign");
    await assert.rejects(rejectPayment("cs_foreign","acct_foreign"),e=>e.code==='22023');
    await pool.query("update public.booking_holds set stripe_checkout_session_id='cs_other' where id=$1",[hold]);
    await assert.rejects(rejectPayment("cs_foreign"),e=>e.code==='22023');
    assert.deepEqual((await state()).sessions,[]);
    assert.equal((await pool.query("select count(*)::int n from public.booking_holds")).rows[0].n,1);
  });
  test("a hold deletion failure rolls back the rejected audit in the same transaction",async()=>{
    await register("cs_delete_failure");
    await pool.query(`CREATE FUNCTION public.test_reject_hold_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='Synthetic delete failure'; END; $$;
      CREATE TRIGGER test_hold_delete BEFORE DELETE ON public.booking_holds FOR EACH ROW EXECUTE FUNCTION public.test_reject_hold_delete();`);
    try { await assert.rejects(rejectPayment("cs_delete_failure"),e=>e.code==='P0099');assert.deepEqual((await state()).sessions,[]); }
    finally {await pool.query('DROP TRIGGER test_hold_delete ON public.booking_holds; DROP FUNCTION public.test_reject_hold_delete();');}
  });
  test("unpaid extension cleanup accepts legacy hold snapshot and atomically removes the correct pair",async()=>{
    await register("cs_terminal");
    const call=(account='acct_test')=>pool.query('select public.release_unpaid_extension_checkout($1,$2) released',['cs_terminal',account]);
    await assert.rejects(call('acct_foreign'),e=>e.code==='22023');
    assert.equal((await call()).rows[0].released,true);assert.equal((await call()).rows[0].released,false);
    for(const table of ['booking_holds','pending_booking_extensions'])assert.equal((await pool.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
    assert.equal((await state()).hours,1);
  });
  test("new settlement functions are executable only by service_role",async()=>{
    for(const fn of ['public.record_rejected_booking_extension(text,text,text,text,integer,timestamptz)','public.release_unpaid_extension_checkout(text,text)']){
      const r=(await pool.query("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service",[fn])).rows[0];
      assert.deepEqual(r,{anon:false,authenticated:false,service:true});
    }
  });

});
