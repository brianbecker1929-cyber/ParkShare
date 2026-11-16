import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifyPaymentAlertHealth} from '../api/_payment-alert-health.js';

export async function runPaymentAlertHealthProbe(db,report){
  const check=name=>report.checks.push({name:'payment alert health: '+name,status:'passed'});
  await db.exec(await readFile(new URL('../docs/sql-proposals/payment-alert-health.sql',import.meta.url),'utf8'));
  report.migrations.push({name:'payment_alert_health_proposal',status:'passed'});
  const service=async(sql,args=[])=>{
    await db.exec('begin;set local role service_role;');
    try{const result=await db.query(sql,args);await db.exec('commit');return result;}
    catch(error){await db.exec('rollback');throw error;}
  };
  const health=async live=>(await service('select public.get_payment_alert_health($1) h',[live])).rows[0].h;
  assert.equal((await db.query('select count(*)::int n from public.payment_alert_worker_health')).rows[0].n,0);
  assert.ok(classifyPaymentAlertHealth(await health(false)).includes('worker_missing'));
  check('empty worker state reports missing heartbeat without creating one');
  for(const role of ['anon','authenticated'])for(const sql of [
    'select * from public.payment_alert_worker_health',
    'select public.record_payment_alert_worker_health(false,0)',
    'select public.get_payment_alert_health(false)',
  ]){
    await db.exec('begin;set local role '+role+';');
    try{await assert.rejects(()=>db.query(sql),error=>error.code==='42501');}finally{await db.exec('rollback');}
  }
  check('public and authenticated roles cannot read or forge heartbeat/health');
  const security=(await db.query(`select c.relrowsecurity rls,
    (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.oid in
      ('public.record_payment_alert_worker_health(boolean,integer)'::regprocedure,
       'public.get_payment_alert_health(boolean)'::regprocedure)) invoker_safe
    from pg_class c where c.oid='public.payment_alert_worker_health'::regclass`)).rows[0];
  assert.deepEqual(security,{rls:true,invoker_safe:true});check('RLS and fixed-search-path invoker functions protect health data');
  await service('select public.record_payment_alert_worker_health(false,0)');
  const healthy=await health(false);assert.ok(healthy.worker_completed_at);
  assert.ok(!classifyPaymentAlertHealth(healthy).includes('worker_missing'));
  const before=(await db.query('select * from public.payment_alert_worker_health')).rows;
  await health(false);await health(false);
  assert.deepEqual((await db.query('select * from public.payment_alert_worker_health')).rows,before);
  assert.equal((await health(true)).worker_completed_at,null);
  check('probe reads never advance heartbeat and modes are isolated');
  await db.exec("update public.payment_alert_worker_health set completed_at=clock_timestamp()-interval '6 minutes' where not livemode;");
  assert.ok(classifyPaymentAlertHealth(await health(false)).includes('worker_stale'));
  await service('select public.record_payment_alert_worker_health(false,1)');
  assert.ok(classifyPaymentAlertHealth(await health(false)).includes('worker_failed'));
  await service('select public.record_payment_alert_worker_health(false,0)');
  check('a stopped worker and failed batch are reported and a valid completion refreshes state');
  const payload={from:'ParkShare QA <qa@myparkshare.ca>',to:['operator@example.invalid'],subject:'Synthetic health fixture',text:'Synthetic only'};
  const queued=(await service('select * from public.enqueue_payment_alert($1,$2,false,$3::jsonb)',
    ['parkshare-payment-alert-v2/qa/refund_failed/'+String(9001).padStart(64,'0'),'refund_failed',JSON.stringify(payload)])).rows[0];
  await db.query("update public.payment_alert_deliveries set created_at=clock_timestamp()-interval '16 minutes' where id=$1",[queued.id]);
  const summary=await health(false);
  assert.ok(summary.pending_count>0);assert.ok(summary.stale_pending_count>0);assert.ok(summary.blocked_count>0);
  assert.ok(classifyPaymentAlertHealth(summary).includes('queue_stalled'));
  assert.ok(classifyPaymentAlertHealth(summary).includes('queue_blocked'));
  assert.equal((await health(true)).pending_count,0);assert.equal((await health(true)).blocked_count,0);
  assert.deepEqual(Object.keys(summary).sort(),['observed_at','worker_completed_at','worker_failed_count','pending_count','blocked_count','stale_pending_count'].sort());
  check('stalled/blocked aggregates are mode scoped and contain no message or incident identifiers');
  for(const args of [[false,-1],[false,6],[null,0],[false,null]])await assert.rejects(
    ()=>service('select public.record_payment_alert_worker_health($1,$2)',args),error=>error.code==='22023');
  check('invalid worker completion cannot forge a healthy state');
}
