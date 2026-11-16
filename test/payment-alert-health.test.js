import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {classifyPaymentAlertHealth,getPaymentAlertHealth,recordPaymentAlertWorkerHealth} from '../api/_payment-alert-health.js';
import {monitorConfiguration,runPaymentAlertMonitor} from '../scripts/payment-alert-monitor.mjs';

const NOW=Date.parse('2026-11-16T18:00Z'), stamp=n=>new Date(n).toISOString(), probe=randomUUID();
const healthyPayload=()=>({version:1,probe,environment:'qa',livemode:false,observedAt:stamp(NOW),healthy:true,issues:[],
  workerCompletedAt:stamp(NOW-1000),pendingCount:0,blockedCount:0,stalePendingCount:0,workerFailedCount:0});
const env={PAYMENT_ALERTS_ENABLED:'true',PAYMENT_ALERTS_ENVIRONMENT:'qa',PAYMENT_ALERT_EMAIL_TO:'operator@example.invalid',
  EMAIL_FROM:'ParkShare QA <qa@myparkshare.ca>',RESEND_API_KEY:'re_synthetic_only',SUPABASE_SERVICE_ROLE_KEY:'synthetic_service',
  STRIPE_SECRET_KEY:'sk_test_synthetic',VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC',
  SUPABASE_URL:'https://heqxirlsorcztsawaldg.supabase.co',PAYMENT_ALERT_MONITOR_SECRET:'s'.repeat(48),
  PAYMENT_ALERT_MONITOR_ENVIRONMENT:'qa',PAYMENT_ALERT_MONITOR_FROM:'ParkShare QA <qa@myparkshare.ca>',PAYMENT_ALERT_MONITOR_SEND_EMAIL:'true'};
const snapshot=changes=>({observed_at:stamp(NOW),worker_completed_at:stamp(NOW-1000),worker_failed_count:0,
  pending_count:0,blocked_count:0,stale_pending_count:0,...changes});
function database({value=snapshot(),error=false,throws=false}={}){
  const calls=[];
  return {calls,rpc(name,args){calls.push({name,args});return {abortSignal:async signal=>{
    assert.ok(signal instanceof AbortSignal);if(throws)throw Error('SYNTHETIC_PRIVATE_FAILURE');
    return {error:error?{message:'SYNTHETIC_PRIVATE_FAILURE'}:null,data:name==='record_payment_alert_worker_health'?value===false?false:true:value};
  }};}};
}

test('health separates missing/stopped workers, failed batches, old pending jobs and blocked jobs',()=>{
  assert.deepEqual(classifyPaymentAlertHealth(snapshot(),NOW),[]);
  for(const [change,issue] of [[{worker_completed_at:null},'worker_missing'],[{worker_completed_at:stamp(NOW-300001)},'worker_stale'],
    [{worker_failed_count:1},'worker_failed'],[{pending_count:1,stale_pending_count:1},'queue_stalled'],[{blocked_count:1},'queue_blocked']]){
    assert.deepEqual(classifyPaymentAlertHealth(snapshot(change),NOW),[issue]);
  }
  assert.deepEqual(classifyPaymentAlertHealth(snapshot({worker_completed_at:stamp(NOW-300000)}),NOW),[]);
});
test('malformed, stale and future health snapshots never return healthy',()=>{
  for(const change of [{observed_at:stamp(NOW-60001)},{observed_at:'bad'},{worker_completed_at:'bad'},
    {worker_completed_at:stamp(NOW+2000)},{pending_count:-1},{pending_count:'1'},{blocked_count:null},
    {worker_failed_count:6},{pending_count:0,stale_pending_count:1}]){
    assert.deepEqual(classifyPaymentAlertHealth(snapshot(change),NOW),['health_invalid']);
  }
});
test('summary probe uses only a mode-scoped read RPC and exports no queue payloads',async()=>{
  const db=database({value:{...snapshot(),payload:'PRIVATE',secret:'PRIVATE'}});
  const result=await getPaymentAlertHealth({db,env,probe,now:NOW});assert.equal(result.healthy,true);
  assert.deepEqual(db.calls,[{name:'get_payment_alert_health',args:{p_livemode:false}}]);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|payload|secret/);
  assert.equal(result.probe,probe);assert.equal(result.livemode,false);
});
test('database errors, missing schema and disabled app configuration fail closed without sending email',async()=>{
  for(const options of [{error:true},{throws:true},{value:null}]){
    const result=await getPaymentAlertHealth({db:database(options),env,probe,now:NOW});assert.equal(result.healthy,false);
    assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_PRIVATE_FAILURE/);
  }
  const db=database(),result=await getPaymentAlertHealth({db,env:{...env,PAYMENT_ALERTS_ENABLED:'false'},probe,now:NOW});
  assert.deepEqual(result.issues,['configuration_inactive']);assert.equal(db.calls.length,0);
});
test('worker records completion through server-clock RPC only after a valid configured result',async()=>{
  const db=database();await recordPaymentAlertWorkerHealth({db,env,counts:{failed:2}});
  assert.deepEqual(db.calls,[{name:'record_payment_alert_worker_health',args:{p_livemode:false,p_failed_count:2}}]);
  for(const failed of [undefined,-1,6,'1',NaN])await assert.rejects(()=>recordPaymentAlertWorkerHealth({db,env,counts:{failed}}));
  assert.equal(db.calls.length,1);
  for(const options of [{error:true},{throws:true},{value:false}])await assert.rejects(()=>recordPaymentAlertWorkerHealth({db:database(options),env,counts:{failed:0}}));
});

const raw=await readFile(new URL('../api/payment-alert-health.js',import.meta.url),'utf8');
const source=raw.slice(raw.indexOf('export default async function handler')).replace('export default async function handler','return async function handler');
function endpoint(environment=env){
  const calls=[];
  const handler=new Function('process','timingSafeEqual','createClient','getPaymentAlertHealth',source)
    ({env:environment},timingSafeEqual,()=>{calls.push('database');return {};},async()=>({healthy:true}));
  return {calls,async run({method='GET',auth=`Bearer ${env.PAYMENT_ALERT_MONITOR_SECRET}`,nonce=probe}={}){
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
    await handler({method,headers:{authorization:auth,'x-parkshare-health-probe':nonce}},res);return res;
  }};
}
test('health endpoint rejects public access, worker credentials and bad methods before any database access',async()=>{
  for(const [request,status] of [[{method:'POST'},405],[{auth:''},401],[{auth:[]},401],[{auth:'Bearer CRON_SECRET'},401],[{nonce:'bad'},400]]){
    const f=endpoint(),r=await f.run(request);assert.equal(r.code,status);assert.equal(f.calls.length,0);
  }
  const f=endpoint({...env,PAYMENT_ALERT_MONITOR_SECRET:''});assert.equal((await f.run()).code,503);assert.equal(f.calls.length,0);
  const reused=endpoint({...env,CRON_SECRET:env.PAYMENT_ALERT_MONITOR_SECRET});assert.equal((await reused.run()).code,503);assert.equal(reused.calls.length,0);
  const allowed=await endpoint().run();assert.equal(allowed.code,200);assert.equal(allowed.headers['Cache-Control'],'private, no-store');
});

async function run({health,fetchError,changes={},providerStatus=200,providerBody={id:randomUUID()}}={}){
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url,options});assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    if(url==='https://api.resend.com/emails')return Response.json(providerBody,{status:providerStatus});
    if(fetchError)throw Error('PRIVATE_NETWORK_FAILURE');
    const data=health ?? healthyPayload();
    return Response.json(data,{status:data.healthy?200:503});
  };
  return {result:await runPaymentAlertMonitor({env:{...env,...changes},fetchImpl,now:NOW,probe}),requests};
}
test('independent checker sends nothing on a fresh healthy response',async()=>{
  const {result,requests}=await run();assert.equal(result.healthy,true);assert.equal(requests.length,1);
});
test('checker rejects stale/cached, wrong-mode, wrong-probe, wrong-schema and inconsistent success',async()=>{
  const healthy=healthyPayload();
  for(const change of [{probe:randomUUID()},{version:2},{environment:'production'},{livemode:true},
    {observedAt:stamp(NOW-60001)},{issues:['queue_blocked']},{healthy:false,issues:[]},{issues:['PRIVATE_UNEXPECTED']},
    {workerCompletedAt:null},{workerFailedCount:1},{blockedCount:1},{pendingCount:undefined}]){
    const {result}=await run({health:{...healthy,...change}});assert.equal(result.healthy,false);assert.deepEqual(result.issues,['probe_failed']);
  }
});
test('database/probe outages notify directly without using the failed queue or leaking error details',async()=>{
  const {result,requests}=await run({fetchError:true});assert.equal(result.notification,'accepted');assert.equal(requests.length,2);
  assert.equal(requests[1].url,'https://api.resend.com/emails');assert.doesNotMatch(requests[1].options.body,/PRIVATE|s{48}|re_synthetic/);
  assert.deepEqual(JSON.parse(requests[1].options.body).to,['operator@example.invalid']);
});
test('changing symptoms in one window retries the identical email body/key',async()=>{
  const a=await run({fetchError:true});
  const b=await run({health:{...healthyPayload(),healthy:false,blockedCount:1,issues:['queue_blocked']}});
  assert.deepEqual(b.result.issues,['queue_blocked']);
  assert.equal(a.requests[1].options.body,b.requests[1].options.body);
  assert.equal(a.requests[1].options.headers['Idempotency-Key'],b.requests[1].options.headers['Idempotency-Key']);
});
test('monitor dry run never sends, and provider failures retain an unhealthy result',async()=>{
  const dry=await run({fetchError:true,changes:{PAYMENT_ALERT_MONITOR_SEND_EMAIL:'false'}});
  assert.equal(dry.requests.length,1);assert.equal(dry.result.notification,'dry_run');
  for(const [providerStatus,notification] of [[401,'rejected'],[409,'uncertain'],[429,'uncertain'],[503,'uncertain']]){
    const r=await run({fetchError:true,providerStatus});assert.equal(r.result.healthy,false);assert.equal(r.result.notification,notification);
  }
});
test('misconfigured monitor targets and recipients fail before transmission',()=>{
  for(const change of [{PAYMENT_ALERT_MONITOR_ENVIRONMENT:'constructor'},{PAYMENT_ALERT_MONITOR_ENVIRONMENT:'elsewhere'},
    {PAYMENT_ALERT_MONITOR_SECRET:''},{PAYMENT_ALERT_MONITOR_SECRET:'x\r\n'.repeat(20)},
    {PAYMENT_ALERT_EMAIL_TO:'one@example.invalid,two@example.invalid'},{PAYMENT_ALERT_MONITOR_FROM:'a@other.invalid'},
    {PAYMENT_ALERT_MONITOR_SEND_EMAIL:'yes'}])assert.equal(monitorConfiguration({...env,...change}),null);
});

test('privileged monitor workflow is gated, restricted to reviewed default-branch code and has no PR trigger',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/payment-alert-monitor.yml',import.meta.url),'utf8');
  assert.match(workflow,/vars\.PAYMENT_ALERT_MONITOR_ENABLED == 'true'.*github\.ref == format\('refs\/heads\/\{0\}'/);
  assert.doesNotMatch(workflow,/pull_request|contents: write|persist-credentials: true/);
  assert.match(workflow,/contents: read/);assert.match(workflow,/persist-credentials: false/);
  assert.doesNotMatch(workflow,/CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY/);
  for(const line of workflow.split('\n').filter(line=>line.includes('uses:'))){assert.match(line,/@[0-9a-f]{40}$/);}
});

test('checker reports redirects, oversized bodies, invalid JSON and inconsistent HTTP statuses as failures',async()=>{
  for(const response of [()=>new Response('redirect',{status:302}),()=>new Response('x'.repeat(9000)),
    ()=>new Response('not JSON'),()=>Response.json(healthyPayload(),{status:503})]){
    const result=await runPaymentAlertMonitor({env:{...env,PAYMENT_ALERT_MONITOR_SEND_EMAIL:'false'},now:NOW,probe,fetchImpl:async()=>response()});
    assert.deepEqual(result.issues,['probe_failed']);assert.equal(result.healthy,false);
  }
});
