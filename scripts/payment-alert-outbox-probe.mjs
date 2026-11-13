import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export async function runPaymentAlertProbe(db, report, peerConnection) {
  const check = name => report.checks.push({name:'payment alert outbox: '+name,status:'passed'});
  await db.exec(await readFile(new URL('../docs/sql-proposals/payment-emergency-alert-outbox.sql',import.meta.url),'utf8'));
  report.migrations.push({name:'payment_emergency_alert_outbox_proposal',status:'passed'});
  assert.equal((await db.query('select count(*)::int n from public.payment_alert_deliveries')).rows[0].n,0);
  check('proposal starts empty and performs no historical replay');
  const payload={from:'ParkShare <alerts@myparkshare.ca>',to:['operator@example.invalid'],subject:'Synthetic TEST alert',text:'Synthetic only'};
  const key=n=>'parkshare-payment-alert-v2/qa/refund_failed/'+String(n).padStart(64,'0');
  const asService=async(connection,sql,args=[])=>{
    await connection.query('begin;set local role service_role;');
    try {const result=await connection.query(sql,args);await connection.query('commit');return result;}
    catch(error){await connection.query('rollback');throw error;}
  };
  const enqueue=(n,p=payload)=>asService(db,'select * from public.enqueue_payment_alert($1,$2,$3,$4::jsonb)',[key(n),'refund_failed',false,JSON.stringify(p)]);
  const first=(await enqueue(1)).rows[0], again=(await enqueue(1)).rows[0];
  assert.equal(first.id,again.id);assert.equal((await db.query('select count(*)::int n from public.payment_alert_deliveries')).rows[0].n,1);
  check('repeated incident enqueues one immutable row');
  await assert.rejects(()=>enqueue(1,{...payload,text:'different'}),e=>e.code==='22023');
  check('same reference with different content is rejected');
  for(const role of ['anon','authenticated']) {
    for(const [sql,args] of [
      ['select * from public.payment_alert_deliveries',[]],
      ['update public.payment_alert_deliveries set blocked_at=now()',[]],
      ['select * from public.enqueue_payment_alert($1,$2,$3,$4::jsonb)',[key(2),'refund_failed',false,JSON.stringify(payload)]],
      ['select * from public.claim_payment_alert($1,$2,false)',[first.id,randomUUID()]],
      ['select public.finish_payment_alert($1,$2,$3)',[first.id,randomUUID(),'retry']],
    ]) {
      await db.exec('begin;set local role '+role+';');
      try {await assert.rejects(()=>db.query(sql,args),e=>e.code==='42501');}finally{await db.exec('rollback;');}
    }
  }
  check('anonymous and authenticated clients cannot read, write or call queue functions');
  const security=(await db.query(`select c.relrowsecurity rls,
    (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
      where p.oid in ('public.enqueue_payment_alert(text,text,boolean,jsonb)'::regprocedure,
        'public.claim_payment_alert(uuid,uuid,boolean)'::regprocedure,
        'public.finish_payment_alert(uuid,uuid,text,uuid,text,integer)'::regprocedure)) invoker_safe
    from pg_class c where c.oid='public.payment_alert_deliveries'::regclass`)).rows[0];
  assert.deepEqual(security,{rls:true,invoker_safe:true});check('RLS and fixed-search-path invoker functions protect queue state');
  const peer=await peerConnection();
  const claim=(connection,id,token,live=false)=>asService(connection,'select * from public.claim_payment_alert($1,$2,$3)',[id,token,live]);
  const finish=(id,token,outcome,provider=null,code=null,delay=30)=>asService(db,'select public.finish_payment_alert($1,$2,$3,$4,$5,$6) ok',[id,token,outcome,provider,code,delay]);
  try {
    const tokens=[randomUUID(),randomUUID()], claims=await Promise.all([claim(db,first.id,tokens[0]),claim(peer,first.id,tokens[1])]);
    assert.equal(claims.filter(r=>r.rows[0]?.id).length,1);
    const winner=claims.findIndex(r=>r.rows[0]?.id),token=tokens[winner];
    check('two database workers acquire one lease');
    assert.equal((await finish(first.id,randomUUID(),'blocked',null,'provider_rejected')).rows[0].ok,false);
    assert.equal((await finish(first.id,token,'retry',null,'provider_unavailable',90)).rows[0].ok,true);
    assert.equal((await claim(peer,first.id,randomUUID())).rows[0]?.id ?? null,null);
    const pending=(await db.query('select * from public.payment_alert_deliveries where id=$1',[first.id])).rows[0];
    assert.deepEqual(pending.payload,payload);assert.equal(pending.idempotency_key,key(1));assert.equal(pending.attempts,1);
    check('lease ownership and durable backoff preserve the original payload and key');
    await db.query("update public.payment_alert_deliveries set next_attempt_at='-infinity',lease_until='-infinity' where id=$1",[first.id]);
    const nextToken=randomUUID(),next=(await claim(peer,first.id,nextToken)).rows[0];
    assert.equal(next.attempts,2);assert.equal(+next.first_attempt_at,+pending.first_attempt_at);
    const provider=randomUUID();assert.equal((await finish(first.id,nextToken,'accepted',provider)).rows[0].ok,true);
    await db.query("update public.payment_alert_deliveries set first_attempt_at=now()-interval '25 hours',lease_until='-infinity' where id=$1",[first.id]);
    assert.equal((await claim(db,first.id,randomUUID())).rows[0]?.id ?? null,null);
    assert.ok((await enqueue(1)).rows[0].accepted_at);check('accepted notification stays deduplicated beyond provider retention');
    const expired=(await enqueue(2)).rows[0];
    await db.query("update public.payment_alert_deliveries set first_attempt_at=now()-interval '23 hours' where id=$1",[expired.id]);
    const blocked=(await claim(peer,expired.id,randomUUID())).rows[0];
    assert.ok(blocked.blocked_at);assert.equal(blocked.last_error_code,'idempotency_window_expired');
    check('ambiguous delivery blocks before provider idempotency expiry');
    const limited=(await enqueue(3)).rows[0];await db.query('update public.payment_alert_deliveries set attempts=8 where id=$1',[limited.id]);
    assert.equal((await claim(peer,limited.id,randomUUID())).rows[0].last_error_code,'attempts_exhausted');
    check('attempt cap is enforced atomically even after a crashed worker');
    const mode=(await enqueue(4)).rows[0];
    assert.equal((await claim(peer,mode.id,randomUUID(),true)).rows[0]?.id ?? null,null);
    check('mode mismatch cannot claim a job');
    const blockToken=randomUUID();await claim(peer,mode.id,blockToken);
    await finish(mode.id,blockToken,'blocked',null,'provider_rejected');
    assert.equal((await claim(peer,mode.id,randomUUID())).rows[0]?.id ?? null,null);
    check('permanent failure remains blocked for operator reconciliation');
  } finally {await peer.end();}
}
