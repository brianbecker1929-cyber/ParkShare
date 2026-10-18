// INTEGRATION: PR #167 Driver quotas plus PR #174/#180 extensions.
// This CI fixture DROPS schemas. TEST_DATABASE_URL MUST NOT be live/active QA.
import assert from "node:assert/strict";
import {after,before,beforeEach,describe,test} from "node:test";
import {readFile} from "node:fs/promises";
import pg from "pg";
const {Pool}=pg, url=process.env.TEST_DATABASE_URL;
const HOST="00000000-0000-4000-8000-000000000c51";
const RENTER="00000000-0000-4000-8000-000000000c52";
const read=p=>readFile(new URL(p,import.meta.url),"utf8");
const schema=[
"CREATE TABLE public.booking_extensions (id bigint generated always as identity primary key,",
"booking_id bigint not null references public.bookings(id) on delete cascade,",
"added_hours numeric not null check(added_hours>0),added_amount numeric not null check(added_amount>=0),",
"stripe_checkout_session_id text unique,stripe_payment_intent_id text,stripe_charge_id text,",
"stripe_connected_account_id text,status text not null,paid_at timestamptz,",
"created_at timestamptz not null default now());",
"CREATE OR REPLACE FUNCTION public.test_recompute_session_range() RETURNS trigger",
"LANGUAGE plpgsql AS $body$ BEGIN",
"IF new.hours IS DISTINCT FROM old.hours THEN",
"new.session_range:=tstzrange(lower(old.session_range),lower(old.session_range)+",
"(new.hours::text||' hours')::interval,'[)'); END IF; RETURN new; END; $body$;",
"CREATE TRIGGER bookings_test_session_range BEFORE UPDATE ON public.bookings",
"FOR EACH ROW EXECUTE FUNCTION public.test_recompute_session_range();",
].join("\n");

describe("combined Driver hold quotas and paid extension reservation (disposable PG)",{skip:!url,concurrency:1},()=>{
 let pool,listing,booking;
 before(async()=>{
  pool=new Pool({connectionString:url,connectionTimeoutMillis:5000,max:6});
  for(const p of ["./booking-holds-fixture.sql","../../supabase-migration-005-booking-holds.sql",
   "../../supabase-migration-011-registered-checkouts.sql",
   "../../docs/sql-proposals/bug-005118-unpaid-hold-rate-limits.sql"]) await pool.query(await read(p));
  await pool.query(schema);
  await pool.query(await read("../../docs/sql-proposals/qa-atomic-extensions-and-refunds.sql"));
 });
 after(async()=>{await pool?.end()});
 beforeEach(async()=>{
  await pool.query("truncate public.booking_hold_attempts,public.booking_extensions,public.pending_booking_extensions,public.booking_holds,public.bookings,public.listings,public.profiles,auth.users restart identity cascade");
  await pool.query("insert into auth.users(id) values($1),($2)",[HOST,RENTER]);
  await pool.query("insert into public.profiles(id) values($1),($2)",[HOST,RENTER]);
  listing=(await pool.query("insert into public.listings(host_id,spaces) values($1,1) returning id",[HOST])).rows[0].id;
  booking=(await pool.query("insert into public.bookings(listing_id,renter_id,status,spot_label,hours,paid_at,session_range,stripe_connected_account_id) values($1,$2,'confirmed','A',1,now()-interval '30 minutes',tstzrange(now()-interval '30 minutes',now()+interval '30 minutes','[)'),'acct_test') returning id",[listing,RENTER])).rows[0].id;
 });
 const standard=()=>pool.query("select public.create_booking_hold($1,$2,'A',upper(b.session_range),upper(b.session_range)+interval '1 hour',now()+interval '30 minutes') as id from public.bookings b where b.id=$3",[listing,RENTER,booking]);
 const extension=()=>pool.query("select * from public.reserve_extension_checkout_hold($1,$2,$3,$4)",[booking,RENTER,1,new Date(Date.now()+1800000).toISOString()]);
 test("installed normal and extension RPCs acquire Driver lock before listing lock",async()=>{
  const q="select pg_get_functiondef('public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)'::regprocedure) normal,pg_get_functiondef('public.reserve_extension_checkout_hold(bigint,uuid,numeric,timestamptz)'::regprocedure) extension";
  const row=(await pool.query(q)).rows[0];
  for(const [key,list] of [["normal","pg_advisory_xact_lock(p_listing_id)"],["extension","pg_advisory_xact_lock(v_listing_id)"]]){
   const code=row[key],driver=code.indexOf("pg_advisory_xact_lock(5118, hashtext(");
   assert.ok(driver>=0 && code.indexOf(list,driver)>driver,key);
  }
 });
 test("simultaneous normal and extension checkout on same Driver/spot cannot both reserve",{timeout:12000},async()=>{
  const outcomes=await Promise.allSettled([standard(),extension()]);
  assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
  const failure=outcomes.find(x=>x.status==="rejected");
  assert.equal(failure?.reason?.code,"P0001");
  assert.equal((await pool.query("select count(*)::int n from public.booking_holds where expires_at>now()")).rows[0].n,1);
  assert.equal(Number((await pool.query("select hours from public.bookings where id=$1",[booking])).rows[0].hours),1);
 });
 test("active Driver quota blocks extension before Stripe checkout",async()=>{
  await pool.query("insert into public.booking_holds(listing_id,renter_id,starts_at,ends_at,expires_at,spot_label) values($1,$2,now()+interval '2 hours',now()+interval '3 hours',now()+interval '30 minutes','B'),($1,$2,now()+interval '4 hours',now()+interval '5 hours',now()+interval '30 minutes','C')",[listing,RENTER]);
  await assert.rejects(extension(),e=>e.code==="P0058");
  assert.equal((await pool.query("select count(*)::int n from public.booking_holds")).rows[0].n,2);
 });
});
