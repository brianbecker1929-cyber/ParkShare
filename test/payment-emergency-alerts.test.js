import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPaymentAlert, createPaymentAlertReporter, paymentAlertConfiguration} from '../api/_payment-alerts.js';
import {drainPaymentAlerts, processPaymentAlert} from '../api/_payment-alert-worker.js';

const qa = () => ({PAYMENT_ALERTS_ENABLED:'true',PAYMENT_ALERTS_ENVIRONMENT:'qa',PAYMENT_ALERT_EMAIL_TO:'operator@example.invalid',
  EMAIL_FROM:'ParkShare <alerts@myparkshare.ca>',RESEND_API_KEY:'re_synthetic_only',SUPABASE_SERVICE_ROLE_KEY:'synthetic_service_only',
  STRIPE_SECRET_KEY:'sk_test_synthetic_only',VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC',
  SUPABASE_URL:'https://heqxirlsorcztsawaldg.supabase.co'});
const incident = () => ({eventId:'evt_synthetic',sessionId:'cs_test_synthetic',connectedAccountId:'acct_synthetic',livemode:false});
const providerId = '00000000-0000-4000-8000-000000000001';
const accepted = () => ({ok:true,status:200,json:async()=>({id:providerId})});
const copy = value => structuredClone(value);
function transport(env=qa(), response=accepted) {
  const requests=[],logs=[],records=new Map(),faults={},rpcCalls=[];
  let stamp=new Date(),sequence=0;
  const promise = run => ({abortSignal(signal){assert.ok(signal instanceof AbortSignal);return this;},
    then(resolve,reject){return Promise.resolve().then(run).then(resolve,reject);}});
  const db = {rpc(name,p){rpcCalls.push({name,p:copy(p)});return promise(()=>{
    if(faults[name]) {if(faults[name]==='once')delete faults[name];return {error:{message:'DO_NOT_SEND secret'}};}
    if(name==='enqueue_payment_alert') {
      let job=[...records.values()].find(j=>j.idempotency_key===p.p_key);
      if(!job){job={id:`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`,kind:p.p_kind,livemode:p.p_livemode,
        idempotency_key:p.p_key,payload:JSON.parse(JSON.stringify(p.p_payload,Object.keys(p.p_payload).sort())),created_at:stamp.toISOString(),
        attempts:0,first_attempt_at:null,lease_until:new Date(0).toISOString(),next_attempt_at:new Date(0).toISOString(),accepted_at:null,blocked_at:null};records.set(job.id,job);}
      return {data:copy(job)};
    }
    const job=records.get(p.p_id);
    if(name==='claim_payment_alert') {
      if(!job||job.livemode!==p.p_livemode||job.accepted_at||job.blocked_at||Date.parse(job.lease_until)>+stamp||Date.parse(job.next_attempt_at)>+stamp)return {data:null};
      if(job.first_attempt_at&&+stamp-Date.parse(job.first_attempt_at)>=23*3600_000){job.blocked_at=stamp.toISOString();job.last_error_code='idempotency_window_expired';return {data:copy(job)};}
      if(job.attempts>=8){job.blocked_at=stamp.toISOString();job.last_error_code='attempts_exhausted';return {data:copy(job)};}
      Object.assign(job,{lease_token:p.p_token,lease_until:new Date(+stamp+120_000).toISOString(),first_attempt_at:job.first_attempt_at||stamp.toISOString(),attempts:job.attempts+1});
      return {data:copy(job)};
    }
    if(name==='finish_payment_alert') {
      if(!job||job.lease_token!==p.p_token||Date.parse(job.lease_until)<=+stamp||job.accepted_at||job.blocked_at)return {data:false};
      Object.assign(job,{lease_token:null,lease_until:new Date(0).toISOString(),last_error_code:p.p_code});
      if(p.p_outcome==='accepted')Object.assign(job,{accepted_at:stamp.toISOString(),provider_id:p.p_provider_id});
      if(p.p_outcome==='blocked')job.blocked_at=stamp.toISOString();
      if(p.p_outcome==='retry')job.next_attempt_at=new Date(+stamp+p.p_delay_seconds*1000).toISOString();
      return {data:true};
    }
    throw new Error('Unexpected RPC '+name);
  });},from(table){assert.equal(table,'payment_alert_deliveries');const filters=[];let limit=5;return {
    select(){return this;},eq(k,v){filters.push(j=>j[k]===v);return this;},is(k,v){filters.push(j=>j[k]===v);return this;},
    lte(k,v){filters.push(j=>Date.parse(j[k])<=Date.parse(v));return this;},order(){return this;},limit(n){limit=n;return this;},
    abortSignal(signal){assert.ok(signal instanceof AbortSignal);return promise(()=>faults.query?{error:{message:'DO_NOT_SEND'}}:
      {data:[...records.values()].filter(j=>filters.every(f=>f(j))).slice(0,limit).map(j=>({id:j.id}))});},
  };}};
  const reporter=createPaymentAlertReporter({env,db,logger:{info:(...args)=>logs.push(args),error:(...args)=>logs.push(args)}});
  const fetchImpl=async(url,init)=>{requests.push({url,...init});return response();};
  return {env,db,reporter,requests,records,logs,faults,rpcCalls,fetchImpl,
    now:()=>new Date(stamp),advance:ms=>{stamp=new Date(+stamp+ms);},
    drain:()=>drainPaymentAlerts({db,env,fetchImpl,now:new Date(stamp)})};
}

test('disabled or inherited configuration performs no queue or email action',async()=>{
  for(const enabled of [undefined,'','false','TRUE','1']){const f=transport({...qa(),PAYMENT_ALERTS_ENABLED:enabled});
    assert.equal((await f.reporter('paid_checkout_needs_review',incident())).status,'disabled');
    assert.equal((await f.drain()).enabled,false);assert.equal(f.rpcCalls.length,0);assert.equal(f.requests.length,0);}
});
test('mode, project, database and production-target bindings prevent cross-environment alerts',async()=>{
  for(const patch of [{STRIPE_SECRET_KEY:'sk_live_synthetic'},{STRIPE_SECRET_KEY:''},{PAYMENT_ALERTS_ENVIRONMENT:'unknown'},
    {VERCEL_PROJECT_ID:'prj_oGpk1UWJ0NfPfAIxBYQv6bkv437z'},{SUPABASE_URL:'https://oyxrussraxjgqwzpwyca.supabase.co'}]){
    const f=transport({...qa(),...patch});assert.equal((await f.reporter('webhook_processing_failed',incident())).status,'environment_mismatch');assert.equal(f.rpcCalls.length,0);}
  const env={...qa(),PAYMENT_ALERTS_ENVIRONMENT:'production',STRIPE_SECRET_KEY:'rk_live_synthetic',
    VERCEL_PROJECT_ID:'prj_oGpk1UWJ0NfPfAIxBYQv6bkv437z',SUPABASE_URL:'https://oyxrussraxjgqwzpwyca.supabase.co'};
  assert.equal(paymentAlertConfiguration(env).enabled,false);env.VERCEL_ENV='production';const f=transport(env);
  assert.equal((await f.reporter('webhook_processing_failed',{...incident(),livemode:true})).status,'queued');
  assert.equal((await f.drain()).accepted,1);assert.match(JSON.parse(f.requests[0].body).subject,/\bLIVE\b/);
  assert.equal((await f.reporter('webhook_processing_failed',incident())).status,'invalid_alert');
});
test('one approved recipient, explicit verified-domain sender and service-only queue credentials are required',async()=>{
  for(const patch of [{PAYMENT_ALERT_EMAIL_TO:''},{PAYMENT_ALERT_EMAIL_TO:'one@example.invalid,two@example.invalid'},
    {PAYMENT_ALERT_EMAIL_TO:'one@example.invalid\r\nBcc: two@example.invalid'},{EMAIL_FROM:'alerts@example.invalid'},
    {RESEND_API_KEY:''},{SUPABASE_SERVICE_ROLE_KEY:''},{EMAIL_FROM:'alerts@myparkshare.ca>'},
    {EMAIL_FROM:'<alerts@myparkshare.ca'},{EMAIL_FROM:'ParkShare <alerts@myparkshare.ca>\nBcc: hidden@example.invalid'}]){
    const f=transport({...qa(),...patch});assert.equal((await f.reporter('webhook_processing_failed',incident())).status,'configuration_missing');assert.equal(f.rpcCalls.length,0);}
});
test('enqueue is durable before delivery and completed jobs do not resend after the provider cache expires',async()=>{
  const f=transport();assert.equal((await f.reporter('paid_checkout_needs_review',incident())).status,'queued');
  await f.reporter('paid_checkout_needs_review',{...incident(),attempt:3,error:'DO_NOT_SEND'});
  assert.equal(f.records.size,1);assert.equal(f.requests.length,0);
  assert.equal((await f.drain()).accepted,1);f.advance(25*3600_000);
  assert.equal((await f.reporter('paid_checkout_needs_review',incident())).status,'already_accepted');
  assert.equal((await f.drain()).accepted,0);assert.equal(f.requests.length,1);
  assert.deepEqual(JSON.parse(f.requests[0].body).to,['operator@example.invalid']);
});
test('redaction removes customer details, raw errors, arbitrary URLs and malformed IDs before persistence',()=>{
  const config=paymentAlertConfiguration(qa()),alert=buildPaymentAlert('refund_needs_review',{...incident(),bookingId:130,
    operationId:providerId,refundId:'re_safe',metadata:{email:'DO_NOT_SEND'},address:'DO_NOT_SEND',error:'sk_live_DO_NOT_SEND',
    eventId:'evt_unsafe\nDO_NOT_SEND',sessionId:'https://DO_NOT_SEND',reason:'DO_NOT_SEND'},config);
  assert.doesNotMatch(JSON.stringify(alert),/DO_NOT_SEND|sk_live_|metadata|address/);assert.match(alert.payload.text,/bookingId: 130/);
  assert.equal(buildPaymentAlert('untrusted',incident(),config),null);
  assert.equal(buildPaymentAlert('refund_needs_review',{livemode:false,bookingId:130},config),null);
});
test('queue failures stay visible without sending email or throwing into the financial path',async()=>{
  const f=transport();f.faults.enqueue_payment_alert=true;
  assert.equal((await f.reporter('refund_failed',incident())).status,'queue_unavailable');
  assert.equal(f.requests.length,0);assert.doesNotMatch(JSON.stringify(f.logs),/DO_NOT_SEND|re_synthetic_only|sk_test_/);
  const report=createPaymentAlertReporter({env:qa(),db:f.db,logger:{error(){throw new Error('logger failed');}}});
  assert.equal((await report('refund_failed',incident())).status,'queue_unavailable');
});
test('a lost acceptance write retries the frozen body/key under a new lease without duplicating the provider message',async()=>{
  const messages=new Map(),f=transport(qa(),accepted);
  const fetchImpl=async(url,init)=>{f.requests.push({url,...init});messages.set(init.headers['Idempotency-Key'],providerId);return accepted();};
  await f.reporter('refund_failed',incident());const id=[...f.records.keys()][0];f.faults.finish_payment_alert='once';
  const drain=()=>drainPaymentAlerts({db:f.db,env:f.env,fetchImpl,now:f.now()});
  assert.equal((await drain()).failed,1);assert.equal((await drain()).busy,0);assert.equal(f.requests.length,1);
  f.advance(121_000);assert.equal((await drain()).accepted,1);
  assert.equal(messages.size,1);assert.equal(f.requests.length,2);assert.equal(f.requests[0].body,f.requests[1].body);
  assert.equal(f.requests[0].headers['Idempotency-Key'],f.requests[1].headers['Idempotency-Key']);
  assert.equal(f.records.get(id).attempts,2);
});
test('competing workers send a claimed alert once and stale lease completion cannot overwrite it',async()=>{
  const f=transport();await f.reporter('refund_failed',incident());const id=[...f.records.keys()][0],config=paymentAlertConfiguration(f.env);
  const results=await Promise.all([1,2].map(()=>processPaymentAlert({db:f.db,id,config,fetchImpl:f.fetchImpl,now:f.now()})));
  assert.deepEqual(results.sort(),['accepted','busy']);assert.equal(f.requests.length,1);
  const result=await f.db.rpc('finish_payment_alert',{p_id:id,p_token:providerId,p_outcome:'blocked',p_code:'provider_rejected'});
  assert.equal(result.data,false);assert.ok(f.records.get(id).accepted_at);
});
test('rate limits persist bounded backoff without inline sleeping or immediate resend',async()=>{
  let rateLimit=true;const f=transport(qa(),()=>rateLimit?{ok:false,status:429,headers:{get:()=> '90'}}:accepted());
  await f.reporter('refund_failed',incident());assert.equal((await f.drain()).pending,1);
  f.advance(89_000);assert.equal((await f.drain()).pending,0);assert.equal(f.requests.length,1);
  f.advance(1000);rateLimit=false;assert.equal((await f.drain()).accepted,1);assert.equal(f.requests.length,2);
});
test('a provider request still in progress retries the same key, while a payload conflict blocks',async()=>{
  for(const name of ['concurrent_idempotent_requests','invalid_idempotent_request']) {
    const f=transport(qa(),()=>({ok:false,status:409,json:async()=>({name,message:'DO_NOT_SEND'})}));
    await f.reporter('refund_failed',incident());const result=await f.drain();
    assert.equal(result[name==='concurrent_idempotent_requests'?'pending':'blocked'],1);
    assert.doesNotMatch(JSON.stringify(f.logs),/DO_NOT_SEND/);
  }
});
test('permanent rejection, changed recipient and payload corruption block rather than redirect or loop',async()=>{
  for(const mode of ['provider','recipient','payload']){const f=transport(qa(),()=>({ok:false,status:403}));
    await f.reporter('refund_failed',incident());const job=[...f.records.values()][0];
    if(mode==='recipient')f.env.PAYMENT_ALERT_EMAIL_TO='replacement@example.invalid';
    if(mode==='payload')job.payload.text+=' DO_NOT_SEND';
    assert.equal((await f.drain()).blocked,1);f.advance(3600_000);assert.equal((await f.drain()).blocked,0);
    assert.equal(f.requests.length,mode==='provider'?1:0);assert.ok(job.blocked_at);}
});
test('ambiguous delivery expires before 24h and bounded attempts stop prolonged retry loops',async()=>{
  const expired=transport(qa(),()=>{throw new Error('DO_NOT_SEND');});await expired.reporter('refund_failed',incident());
  assert.equal((await expired.drain()).pending,1);expired.advance(23*3600_000);
  assert.equal((await expired.drain()).blocked,1);assert.equal(expired.requests.length,1);
  assert.equal([...expired.records.values()][0].last_error_code,'idempotency_window_expired');
  const exhausted=transport(qa(),()=>({ok:false,status:503}));await exhausted.reporter('refund_failed',incident());
  for(let i=1;i<=8;i++){assert.equal((await exhausted.drain())[i===8?'blocked':'pending'],1);exhausted.advance(3600_000);}
  assert.equal(exhausted.requests.length,8);assert.equal([...exhausted.records.values()][0].last_error_code,'attempts_exhausted');
});
test('an unreadable or ambiguous provider response retains the job, without logging raw errors',async()=>{
  for(const response of [()=>{throw new Error('DO_NOT_SEND');},()=>({ok:true,status:200,json:async()=>{throw new Error('DO_NOT_SEND');}}),
    ()=>({ok:true,status:200,json:async()=>({id:'DO_NOT_SEND'})})]){
    const f=transport(qa(),response);await f.reporter('refund_failed',incident());assert.equal((await f.drain()).pending,1);
    assert.doesNotMatch(JSON.stringify(f.logs),/DO_NOT_SEND|re_synthetic_only/);}
});

const source=readFileSync(new URL('../api/stripe-webhook.js',import.meta.url),'utf8');
function webhook({type='checkout.session.completed',fail=true,unsigned=false,providerFails=false,queueFails=false}={}){
  const f=transport(qa(),providerFails?()=>{throw new Error('provider unavailable');}:accepted);f.faults.enqueue_payment_alert=queueFails;
  const event={id:'evt_synthetic',type,livemode:false,account:'acct_synthetic',data:{object:{id:type.startsWith('refund.')?'re_synthetic':'cs_test_synthetic',payment_status:'paid',status:'failed',metadata:{email:'DO_NOT_SEND'}}}};
  const deps={reportPaymentAlert:f.reporter,readRawBody:async()=> 'signed fixture',stripe:{webhooks:{constructEvent(){if(unsigned)throw new Error('invalid signature');return event;}}},
    processPaidCheckout:async()=>{if(fail)throw new Error('database unavailable DO_NOT_SEND');},recoverRejectedExtensionRefund:async()=>{},
    reconcilePaymentRefund:async()=>{},supabaseAdmin:{},paidCheckoutReferenceLog:()=>null,console:{info(){},error(){}}};
  const code=source.slice(source.indexOf('export default async function handler')).replace('export default async function handler','return async function handler');
  const handler=new Function(...Object.keys(deps),code)(...Object.values(deps));
  return {...f,async run(){const res={status(n){this.code=n;return this;},json(value){this.body=value;return this;},send(){return this;}};
    await handler({method:'POST',headers:{'stripe-signature':'synthetic'}},res);return res;}};
}
test('paid checkout failure preserves HTTP 500 when either the queue or mail provider fails',async()=>{
  for(const options of [{},{queueFails:true},{providerFails:true}]){const f=webhook(options),res=await f.run();
    assert.equal(res.code,500);assert.deepEqual(res.body,{error:'Webhook processing failed'});assert.equal(f.requests.length,0);
    if(!options.queueFails){await f.drain();assert.equal(f.requests.length,1);assert.doesNotMatch(f.requests[0].body,/DO_NOT_SEND/);}}
});
test('successful checkout and invalid signatures never enqueue an emergency alert',async()=>{
  for(const options of [{fail:false},{unsigned:true}]){const f=webhook(options);assert.equal((await f.run()).code,options.unsigned?400:200);assert.equal(f.records.size,0);}
});
test('signed failed refund events enqueue after normal reconciliation without creating another refund',async()=>{
  for(const type of ['refund.failed','refund.updated']){const f=webhook({type});assert.equal((await f.run()).code,200);
    assert.equal(f.records.size,1);assert.equal((await f.drain()).accepted,1);assert.match(JSON.parse(f.requests[0].body).text,/refundId: re_synthetic/);}
});
test('worker batch limits reject invalid counts and a disabled worker does not query the database',async()=>{
  for(const limit of [0,6,1.5])await assert.rejects(()=>drainPaymentAlerts({db:{},env:qa(),limit}),RangeError);
  const f=transport({...qa(),PAYMENT_ALERTS_ENABLED:'false'});assert.equal((await f.drain()).enabled,false);assert.equal(f.rpcCalls.length,0);
});
