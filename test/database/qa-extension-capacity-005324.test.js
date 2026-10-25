import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {after,before,beforeEach,describe,test} from 'node:test';
import pg from 'pg';
const url=process.env.TEST_DATABASE_URL;
const HOST='00000000-0000-4000-8000-000000005324',DRIVER='00000000-0000-4000-8000-000000005325';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
describe('extension capacity deduplication on disposable PostgreSQL',{skip:!url,concurrency:1},()=>{
 let pool,listing,booking;
 before(async()=>{
  pool=new pg.Pool({connectionString:url,max:6,connectionTimeoutMillis:5000});
  for(const file of ['./booking-holds-fixture.sql','../../supabase-migration-005-booking-holds.sql','../../supabase-migration-011-registered-checkouts.sql'])await pool.query(await read(file));
  await pool.query(`CREATE TABLE public.booking_extensions(id bigint generated always as identity primary key,booking_id bigint not null references public.bookings(id),added_hours numeric not null,added_amount numeric not null,stripe_checkout_session_id text unique,stripe_payment_intent_id text,stripe_charge_id text,stripe_connected_account_id text,status text not null,paid_at timestamptz,created_at timestamptz default now());
   CREATE FUNCTION public.recompute_capacity_test_range() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF new.hours IS DISTINCT FROM old.hours THEN new.session_range:=tstzrange(lower(old.session_range),lower(old.session_range)+(new.hours::text||' hours')::interval,'[)'); END IF; RETURN new; END $$;
   CREATE TRIGGER capacity_test_range BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.recompute_capacity_test_range();`);
  for(const file of ['../../docs/sql-proposals/qa-atomic-extensions-and-refunds.sql','../../docs/sql-proposals/bug-005118-unpaid-hold-rate-limits.sql','../../supabase/migrations/20261021040753_extension_settlement_005116_005260.sql','../../supabase/migrations/20261025152330_deduplicate_extension_spot_capacity_005324.sql'])await pool.query(await read(file));
 });
 beforeEach(async()=>{
  await pool.query('truncate public.booking_hold_attempts,public.booking_extensions,public.pending_booking_extensions,public.booking_holds,public.bookings,public.listings,public.profiles,auth.users restart identity cascade');
  await pool.query('insert into auth.users(id) values($1),($2)',[HOST,DRIVER]);await pool.query('insert into public.profiles(id) values($1),($2)',[HOST,DRIVER]);
  listing=(await pool.query('insert into public.listings(host_id,spaces) values($1,2) returning id',[HOST])).rows[0].id;
  booking=(await pool.query(`insert into public.bookings(listing_id,renter_id,hours,total,status,spot_label,paid_at,session_range,stripe_connected_account_id) values($1,$2,1,34.5,'confirmed','A',now()-interval '30 minutes',tstzrange(now()-interval '30 minutes',now()+interval '30 minutes','[)'),'acct_test') returning id`,[listing,DRIVER])).rows[0].id;
 });
 after(async()=>pool?.end());
 async function reserve(session,hours=1){
  const hold=(await pool.query('select * from public.reserve_extension_checkout_hold($1,$2,$3,now()+interval \'30 minutes\')',[booking,DRIVER,hours])).rows[0];
  await pool.query("update public.booking_holds set stripe_checkout_session_id=$2,expected_connected_account_id='acct_test',expected_total_cents=1725 where id=$1",[hold.hold_id,session]);
  await pool.query("insert into public.pending_booking_extensions(booking_id,renter_id,added_hours,expected_total_cents,expected_service_fee_cents,expected_connected_account_id,stripe_checkout_session_id,hold_id) values($1,$2,$3,1725,225,'acct_test',$4,$5)",[booking,DRIVER,hours,session,hold.hold_id]);
  return hold;
 }
 test('a booking and its adjacent extension hold do not block another physical bay',async()=>{
  await reserve('cs_first');
  const result=await pool.query("select public.create_booking_hold($1,$2,'B',lower(b.session_range),upper(b.session_range)+interval '1 hour',now()+interval '20 minutes') as id from public.bookings b where b.id=$3",[listing,HOST,booking]);
  assert.ok(result.rows[0].id);
  await assert.rejects(pool.query("select public.create_booking_hold($1,$2,'A',now(),now()+interval '1 hour',now()+interval '20 minutes')",[listing,HOST]),e=>e.code==='P0001');
 });
 test('paid application also deduplicates another booking and its extension hold, and replay adds no extra time',async()=>{
  const other=(await pool.query("insert into public.bookings(listing_id,renter_id,hours,status,spot_label,paid_at,session_range) values($1,$2,2,'confirmed','B',now()-interval '30 minutes',tstzrange(now()-interval '30 minutes',now()+interval '90 minutes','[)')) returning id",[listing,HOST])).rows[0].id;
  await pool.query("insert into public.booking_holds(listing_id,renter_id,spot_label,starts_at,ends_at,expires_at) select listing_id,renter_id,'B',upper(session_range),upper(session_range)+interval '1 hour',now()+interval '20 minutes' from public.bookings where id=$1",[other]);
  await reserve('cs_two_hours',2);
  const apply=()=>pool.query("select * from public.apply_paid_booking_extension('cs_two_hours',$1,$2,2,1725,'pi_two','ch_two','acct_test',now())",[booking,DRIVER]);
  assert.equal((await apply()).rows[0].applied,true);assert.equal((await apply()).rows[0].applied,false);
  assert.equal(Number((await pool.query('select hours from public.bookings where id=$1',[booking])).rows[0].hours),3);
 });
 test('concurrent Drivers competing for the remaining physical bay cannot overbook it',async()=>{
  await reserve('cs_race');
  const args=[listing,HOST,booking];
  const sql="select public.create_booking_hold($1,$2,'B',lower(b.session_range),upper(b.session_range)+interval '1 hour',now()+interval '20 minutes') from public.bookings b where b.id=$3";
  const outcomes=await Promise.allSettled([pool.query(sql,args),pool.query(sql,args)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(r=>r.status==='rejected'&&r.reason.code==='P0001').length,1);
 });
 test('ordinary clients still cannot create holds or apply paid extensions',async()=>{
  for(const fn of ['public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)','public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz)']){
   for(const role of ['anon','authenticated'])assert.equal((await pool.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,fn])).rows[0].allowed,false);
  }
 });
});
