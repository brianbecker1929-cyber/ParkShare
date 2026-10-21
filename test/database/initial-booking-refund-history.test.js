import assert from 'node:assert/strict';
import {before,beforeEach,after,describe,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {loadSnapshot,restoreSnapshot,applyProposals,assertLocalRehearsalUrl} from '../../scripts/qa-schema-rehearsal.mjs';
import {initialBookingMigration,seedInitialBooking,registerInitial,settleInitial,DRIVER} from '../../scripts/qa-initial-booking-refund-probe.mjs';
const url=process.env.TEST_DATABASE_URL;
describe('initial booking settlement — disposable native PostgreSQL',{skip:!url,concurrency:1},()=>{
 let pool,db,listing;
 before(async()=>{
  assertLocalRehearsalUrl(url);pool=new pg.Pool({connectionString:url,max:4,connectionTimeoutMillis:5000});
  db={query:(sql,args)=>pool.query(sql,args),exec:sql=>pool.query(sql)};
  await db.exec('DROP SCHEMA IF EXISTS parkshare_private CASCADE;');
  await restoreSnapshot(db,await loadSnapshot());await applyProposals(db,[]);
  await db.exec(await readFile(initialBookingMigration,'utf8'));
 });
 beforeEach(async()=>{
  await db.exec('TRUNCATE public.bookings,public.booking_holds,public.pending_booking_extensions,public.listings,public.profiles,auth.users RESTART IDENTITY CASCADE;');
  ({listing}=await seedInitialBooking(db));
 });
 after(async()=>{await pool?.end()});
 const count=async table=>(await db.query('select count(*)::int n from public.'+table)).rows[0].n;
 test('duplicate concurrent paid deliveries grant exactly one booking and consume one hold',async()=>{
  const r=await registerInitial(db,listing,'cs_duplicate');
  const results=await Promise.all([settleInitial(db,r),settleInitial(db,r)]);
  assert.deepEqual(results.map(r=>r.rows[0].result.applied).sort(),[false,true]);
  assert.equal(await count('bookings'),1);assert.equal(await count('booking_holds'),0);
 });
 test('competing late checkouts produce one confirmed reservation and one rejected financial audit',async()=>{
  const a=await registerInitial(db,listing,'cs_race_a');await db.query("update public.booking_holds set expires_at=now()-interval '1 second' where id=$1",[a.hold]);
  const b=await registerInitial(db,listing,'cs_race_b');
  const outcomes=await Promise.all([settleInitial(db,a),settleInitial(db,b)]);
  assert.equal(outcomes.filter(r=>r.rows[0].result.applied).length,1);assert.equal(outcomes.filter(r=>r.rows[0].result.refund_required).length,1);
  assert.equal(await count('bookings'),2);assert.equal(await count('booking_holds'),0);
  assert.equal((await db.query("select count(*)::int n from public.bookings where status='confirmed'")).rows[0].n,1);
 });
 test('rejected checkout remains rejected after conflicting booking disappears and paid event replays',async()=>{
  const r=await registerInitial(db,listing,'cs_rejected');
  await db.query(`insert into public.bookings(listing_id,renter_id,hours,total,status,spot_label,paid_at) values($1,$2,1,10,'confirmed','A',$3)`,[listing,DRIVER,r.booking.paid_at]);
  const first=(await settleInitial(db,r)).rows[0].result;assert.equal(first.refund_required,true);
  await db.query("delete from public.bookings where status='confirmed'");
  const again=(await settleInitial(db,r)).rows[0].result;assert.equal(again.booking.id,first.booking.id);assert.equal(again.applied,false);assert.equal(again.booking.application_state,'rejected');
  await assert.rejects(db.query("update public.bookings set status='confirmed' where id=$1",[first.booking.id]),e=>e.code==='23514');
 });
 test('another active hold is respected and never deleted by rejecting this checkout',async()=>{
  const r=await registerInitial(db,listing,'cs_old');await db.query("update public.booking_holds set expires_at=now()-interval '1 second' where id=$1",[r.hold]);
  const next=await registerInitial(db,listing,'cs_current');const outcome=(await settleInitial(db,r)).rows[0].result;
  assert.equal(outcome.refund_required,true);assert.equal((await db.query('select id from public.booking_holds')).rows[0].id,next.hold);
 });
 test('unlabelled parking cannot exceed listing capacity',async()=>{
  const r=await registerInitial(db,listing,'cs_unlabelled',{spot:null});
  for(let n=0;n<2;n++)await db.query(`insert into public.bookings(listing_id,renter_id,hours,total,status,paid_at) values($1,$2,1,10,'confirmed',$3)`,[listing,DRIVER,r.booking.paid_at]);
  assert.equal((await settleInitial(db,r)).rows[0].result.refund_required,true);
  assert.equal((await db.query("select count(*)::int n from public.bookings where status='confirmed'")).rows[0].n,2);
 });
 test('changed session, renter, account, amount and duration fail without deleting the registration',async()=>{
  const r=await registerInitial(db,listing,'cs_owned');
  for(const change of [{stripe_checkout_session_id:'cs_foreign'},{renter_id:'00000000-0000-4000-8000-000000005299'},
    {stripe_connected_account_id:'acct_other'},{total:12,subtotal:10.5},{hours:2}]){
   await assert.rejects(settleInitial(db,{...r,booking:{...r.booking,...change}}),e=>e.code==='22023');
   assert.equal(await count('bookings'),0);assert.equal(await count('booking_holds'),1);
  }
 });
 test('hold deletion failure rolls back both reservation and financial audit',async()=>{
  const r=await registerInitial(db,listing,'cs_rollback');
  await db.exec(`create function public.test_fail_initial_hold_delete() returns trigger language plpgsql as $$ begin raise exception using errcode='P0099',message='Synthetic delete failure'; end $$;
   create trigger test_initial_hold_delete before delete on public.booking_holds for each row execute function public.test_fail_initial_hold_delete();`);
  try{await assert.rejects(settleInitial(db,r,true),e=>e.code==='P0099');assert.equal(await count('bookings'),0);assert.equal(await count('booking_holds'),1);}
  finally{await db.exec('drop trigger test_initial_hold_delete on public.booking_holds;drop function public.test_fail_initial_hold_delete();');}
 });
 test('late exclusion violation becomes one rejected payment audit instead of losing the charge reference',async()=>{
  const r=await registerInitial(db,listing,'cs_exclusion');
  await db.exec(`create function public.test_late_initial_conflict() returns trigger language plpgsql as $$ begin
   if new.stripe_checkout_session_id='cs_exclusion' and new.status='confirmed' then raise exception using errcode='23P01',message='Synthetic late conflict'; end if;return new;end $$;
   create trigger test_initial_conflict before insert on public.bookings for each row execute function public.test_late_initial_conflict();`);
  try{const result=(await settleInitial(db,r)).rows[0].result;assert.equal(result.refund_required,true);assert.equal(result.booking.checkout_rejection_reason,'booking_conflict');assert.equal(await count('bookings'),1);assert.equal(await count('booking_holds'),0);}
  finally{await db.exec('drop trigger test_initial_conflict on public.bookings;drop function public.test_late_initial_conflict();');}
 });
 test('service role owns execution permission; browser roles cannot call settlement',async()=>{
  const result=(await db.query("select has_function_privilege('anon','public.settle_initial_booking_checkout(uuid,jsonb,boolean)','EXECUTE') anon,has_function_privilege('authenticated','public.settle_initial_booking_checkout(uuid,jsonb,boolean)','EXECUTE') authenticated,has_function_privilege('service_role','public.settle_initial_booking_checkout(uuid,jsonb,boolean)','EXECUTE') service")).rows[0];
  assert.deepEqual(result,{anon:false,authenticated:false,service:true});
 });
});
