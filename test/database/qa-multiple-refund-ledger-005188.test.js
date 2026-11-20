import assert from 'node:assert/strict';
import {before,after,describe,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {assertLocalRehearsalUrl} from '../../scripts/qa-schema-rehearsal.mjs';
const url=process.env.TEST_DATABASE_URL;
describe('multiple refund ledger — native PostgreSQL concurrency',{skip:!url},()=>{
 let pool,id,permissionsBefore;
 const conflictMigration=new URL('../../supabase/migrations/20261031185643_webhook_refund_conflict_005158.sql',import.meta.url);
 const permissionQuery=`SELECT proacl,prosecdef,proconfig,proowner FROM pg_proc WHERE oid='public.reconcile_payment_refunds(text,bigint,text,text,text,boolean,bigint,text,bigint,bigint,jsonb,boolean)'::regprocedure`;
 const entry=(refund_id,amount_cents)=>({refund_id,amount_cents,status:'succeeded',created:1792000000});
 const call=(revision,refunds=[entry('re_first',2000)],reported=2000)=>pool.query(`SELECT public.reconcile_payment_refunds('booking',$1,'acct_owner','pi_base','ch_base',false,$2,'evt_synthetic',10000,$3,$4::jsonb,false) result`,[id,revision,reported,JSON.stringify(refunds)]);
 before(async()=>{
  assertLocalRehearsalUrl(url);
  pool=new pg.Pool({connectionString:url,max:3,connectionTimeoutMillis:5000});
  await pool.query(await readFile(new URL('./booking-holds-fixture.sql',import.meta.url),'utf8'));
  await pool.query(`DROP SCHEMA IF EXISTS parkshare_private CASCADE; CREATE TABLE public.booking_extensions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,booking_id bigint REFERENCES public.bookings(id),added_amount numeric NOT NULL,paid_at timestamptz,status text, stripe_charge_id text,stripe_payment_intent_id text,stripe_connected_account_id text,stripe_refund_id text,refund_amount numeric,refund_status text,refund_failure_reason text,refund_reconciled_at timestamptz,charge_amount_refunded numeric,charge_fully_refunded boolean,charge_disputed boolean NOT NULL DEFAULT false);`);
  await pool.query(await readFile(new URL('../../supabase/migrations/20261019182335_multiple_refund_ledger_005188.sql',import.meta.url),'utf8'));
  permissionsBefore=(await pool.query(permissionQuery)).rows[0];
  await pool.query(await readFile(conflictMigration,'utf8'));
  const host='00000000-0000-4000-8000-000000000061',driver='00000000-0000-4000-8000-000000000062';
  await pool.query('INSERT INTO auth.users(id) VALUES($1),($2)',[host,driver]);await pool.query('INSERT INTO public.profiles(id) VALUES($1),($2)',[host,driver]);
  const listing=(await pool.query('INSERT INTO public.listings(host_id,spaces) VALUES($1,4) RETURNING id',[host])).rows[0].id;
  id=(await pool.query(`INSERT INTO public.bookings(listing_id,renter_id,total,status,paid_at,session_range,stripe_connected_account_id,stripe_payment_intent_id,stripe_charge_id) VALUES($1,$2,100,'confirmed',now(),tstzrange(now(),now()+interval '1 hour','[)'),'acct_owner','pi_base','ch_base') RETURNING id`,[listing,driver])).rows[0].id;
 });
 after(async()=>{await pool?.end()});
 test('two simultaneously delivered snapshots cannot both commit the same revision',async()=>{
  const results=await Promise.allSettled([call(0),call(0)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'PT409');
  assert.equal(results.find(r=>r.status==='rejected').reason.detail,'refund_snapshot_stale');
  assert.equal((await pool.query('SELECT count(*)::int n FROM public.payment_refunds')).rows[0].n,1);
  const b=(await pool.query('SELECT refund_total_amount,refund_ledger_revision FROM public.bookings WHERE id=$1',[id])).rows[0];
  assert.equal(Number(b.refund_total_amount),20);assert.equal(Number(b.refund_ledger_revision),1);
 });
 test('retry with fresh revision persists both partial refunds, retaining the first reference',async()=>{
  await call(1,[entry('re_first',2000),entry('re_second',3000)],5000);
  const b=(await pool.query('SELECT refund_total_amount,stripe_refund_id,refund_amount,status FROM public.bookings WHERE id=$1',[id])).rows[0];
  assert.equal(Number(b.refund_total_amount),50);assert.equal(b.stripe_refund_id,'re_first');assert.equal(Number(b.refund_amount),20);assert.equal(b.status,'confirmed');
 });
 test('cancellation write holding the row lock invalidates a waiting webhook snapshot',async()=>{
  const client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query('SELECT id FROM public.bookings WHERE id=$1 FOR UPDATE',[id]);
   // Attach rejection handler before releasing lock; no unhandled rejection.
   const waiting=call(2,[entry('re_first',2000),entry('re_second',3000)],5000).then(()=>null,e=>e);
   await client.query("UPDATE public.bookings SET refund_status='pending' WHERE id=$1",[id]);await client.query('COMMIT');
   assert.equal((await waiting).code,'PT409');
   assert.equal(Number((await pool.query('SELECT refund_total_amount FROM public.bookings WHERE id=$1',[id])).rows[0].refund_total_amount),50);
  }finally{await client.query('ROLLBACK');client.release();}
 });
 test('conflict migration preserves invoker rights and grants, including on repeated application',async()=>{
  assert.deepEqual((await pool.query(permissionQuery)).rows[0],permissionsBefore);
  await pool.query(await readFile(conflictMigration,'utf8'));
  assert.deepEqual((await pool.query(permissionQuery)).rows[0],permissionsBefore);
  assert.equal(permissionsBefore.prosecdef,false);
  const access=(await pool.query(`SELECT has_function_privilege('anon','public.reconcile_payment_refunds(text,bigint,text,text,text,boolean,bigint,text,bigint,bigint,jsonb,boolean)','EXECUTE') anon,has_function_privilege('authenticated','public.reconcile_payment_refunds(text,bigint,text,text,text,boolean,bigint,text,bigint,bigint,jsonb,boolean)','EXECUTE') authenticated,has_function_privilege('service_role','public.reconcile_payment_refunds(text,bigint,text,text,text,boolean,bigint,text,bigint,bigint,jsonb,boolean)','EXECUTE') service_role`)).rows[0];
  assert.deepEqual(access,{anon:false,authenticated:false,service_role:true});
 });
 test('a stale snapshot returns a terminal conflict without changing any booking or refund row',async()=>{
  const snapshot=async()=>({booking:(await pool.query('SELECT * FROM public.bookings WHERE id=$1',[id])).rows[0],refunds:(await pool.query('SELECT * FROM public.payment_refunds ORDER BY refund_id')).rows});
  const before=await snapshot();
  await assert.rejects(call(0),e=>e.code==='PT409'&&e.detail==='refund_snapshot_stale');
  assert.deepEqual(await snapshot(),before);
 });
});
