// Synthetic disposable PostgreSQL only. This fixture DROPS schemas.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {before,beforeEach,after,describe,test} from 'node:test';
import pg from 'pg';
const url=process.env.TEST_DATABASE_URL;
const HOST='00000000-0000-4000-8000-000000005461',DRIVER='00000000-0000-4000-8000-000000005462',OTHER='00000000-0000-4000-8000-000000005463';
const migration=new URL('../../supabase/migrations/20261031191201_checkout_rate_limit_recovery_005462.sql',import.meta.url);
describe('BUG-005462 timed checkout limits and automatic recovery (disposable PG)',{skip:!url,concurrency:1},()=>{
 let pool,listing,originalMetadata;
 const metadata=async()=>(await pool.query("SELECT proacl::text,prosecdef,proowner,proconfig FROM pg_proc WHERE oid='public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)'::regprocedure")).rows[0];
 before(async()=>{
  pool=new pg.Pool({connectionString:url,max:8,connectionTimeoutMillis:5000});
  for(const path of ['./booking-holds-fixture.sql','../../supabase-migration-005-booking-holds.sql','../../supabase-migration-011-registered-checkouts.sql','../../docs/sql-proposals/bug-005118-unpaid-hold-rate-limits.sql'])await pool.query(await readFile(new URL(path,import.meta.url),'utf8'));
  originalMetadata=await metadata();await pool.query(await readFile(migration,'utf8'));
 });
 beforeEach(async()=>{
  await pool.query('TRUNCATE public.booking_hold_attempts,public.pending_booking_extensions,public.booking_holds,public.bookings,public.listings,public.profiles,auth.users RESTART IDENTITY CASCADE');
  await pool.query('INSERT INTO auth.users(id) VALUES($1),($2),($3)',[HOST,DRIVER,OTHER]);
  await pool.query('INSERT INTO public.profiles(id) VALUES($1),($2),($3)',[HOST,DRIVER,OTHER]);
  listing=(await pool.query('INSERT INTO public.listings(host_id,spaces) VALUES($1,10) RETURNING id',[HOST])).rows[0].id;
 });
 after(async()=>{await pool?.end();});
 const hold=(label='A',driver=DRIVER)=>pool.query("SELECT public.create_booking_hold($1,$2,$3,now()+interval '1 day',now()+interval '25 hours',now()+interval '30 minutes') id",[listing,driver,label]);
 const attempts=ages=>pool.query("INSERT INTO public.booking_hold_attempts(renter_id,hold_id,created_at) SELECT $1,gen_random_uuid(),now()-age*interval '1 minute' FROM unnest($2::numeric[]) age",[DRIVER,ages]);
 async function denied(fn,reason){let error;await assert.rejects(fn,e=>{error=e;return e.code==='P0058';});const detail=JSON.parse(error.detail);assert.equal(detail.version,1);assert.equal(detail.reason,reason);return detail;}
 async function remaining(detail){return Number((await pool.query('SELECT extract(epoch FROM ($1::timestamptz-now())) seconds',[detail.retry_at])).rows[0].seconds);}
 test('the reported four-start timeline blocks at 19:32 but gives the 20:06 retry instant',async()=>{
  await attempts([86,62,31,30]);
  const detail=await denied(()=>hold(),'two_hour_limit');
  assert.deepEqual(detail.limits,['two_hour_limit']);
  assert.ok(Math.abs(await remaining(detail)-34*60)<2);
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.booking_hold_attempts')).rows[0].n,4);
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.booking_holds')).rows[0].n,0);
  assert.ok(await hold('A',OTHER),'another Driver is not blocked');
 });
 test('expired spot leases retain audit evidence; the rolling start window independently clears',async()=>{
  for(const label of ['A','B','C','D']){await hold(label);await pool.query("UPDATE public.booking_holds SET expires_at=now()-interval '1 second'");}
  await denied(()=>hold('E'),'two_hour_limit');
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.booking_holds')).rows[0].n,4);
  await pool.query("UPDATE public.booking_hold_attempts SET created_at=now()-interval '2 hours' WHERE id=(SELECT min(id) FROM public.booking_hold_attempts)");
  assert.ok(await hold('E'));
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.booking_hold_attempts')).rows[0].n,5);
 });
 test('legacy excess active holds calculate the second latest expiry, not an early false retry',async()=>{
  await pool.query("INSERT INTO public.booking_holds(listing_id,renter_id,spot_label,starts_at,ends_at,expires_at) SELECT $1,$2,minutes::text,now()+interval '1 day',now()+interval '25 hours',now()+minutes*interval '1 minute' FROM unnest(ARRAY[5,10,20]) minutes",[listing,DRIVER]);
  const detail=await denied(()=>hold(),'active_checkouts');
  assert.ok(Math.abs(await remaining(detail)-10*60)<2);
  await pool.query("UPDATE public.booking_holds SET expires_at=now()-interval '1 second' WHERE spot_label IN ('5','10')");
  assert.ok(await hold('A'));
 });
 test('all blocking limits contribute and the longest current wait governs the response',async()=>{
  await attempts(Array(12).fill(360));await attempts([86,62,31,30]);
  await pool.query("INSERT INTO public.booking_holds(listing_id,renter_id,starts_at,ends_at,expires_at) SELECT $1,$2,now()+interval '1 day',now()+interval '25 hours',now()+interval '20 minutes' FROM generate_series(1,2)",[listing,DRIVER]);
  const detail=await denied(()=>hold(),'daily_limit');
  assert.deepEqual(detail.limits,['active_checkouts','two_hour_limit','daily_limit']);
  assert.ok(Math.abs(await remaining(detail)-18*3600)<2);
 });
 test('daily starts and old audit records clear without deleting history or manual counter reset',async()=>{
  await attempts(Array(12).fill(180));
  const detail=await denied(()=>hold(),'daily_limit');assert.ok(Math.abs(await remaining(detail)-21*3600)<2);
  await pool.query("UPDATE public.booking_hold_attempts SET created_at=now()-interval '24 hours'");
  assert.ok(await hold());
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.booking_hold_attempts')).rows[0].n,13);
 });
 test('concurrent starts still issue exactly two active holds and do not count denied requests',async()=>{
  const results=await Promise.allSettled(['A','B','C','D','E','F'].map(label=>hold(label)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='P0058').length,4);
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.booking_hold_attempts')).rows[0].n,2);
 });
 test('migration is repeatable and preserves ownership, definer setting, search path and ACL',async()=>{
  assert.deepEqual(await metadata(),originalMetadata);
  await pool.query(await readFile(migration,'utf8'));assert.deepEqual(await metadata(),originalMetadata);
  for(const role of ['anon','authenticated']){
   const q=await pool.query("SELECT has_function_privilege($1,'public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)','EXECUTE') allowed",[role]);
   assert.equal(q.rows[0].allowed,false);
  }
 });
});
