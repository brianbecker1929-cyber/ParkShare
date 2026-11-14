// Disposable GitHub runner ONLY. No hosted credentials, real payment APIs,
// external email sends or active QA resources are used by this rehearsal.
import assert from 'node:assert/strict';
import {createHmac, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import pg from 'pg';
import Stripe from 'stripe';
import {createClient} from '@supabase/supabase-js';
import {assertLocalRehearsalUrl, literal} from './qa-schema-rehearsal.mjs';
import {createPaymentAlertReporter} from '../api/_payment-alerts.js';
import {drainPaymentAlerts} from '../api/_payment-alert-worker.js';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Alert integration requires a disposable GitHub runner');
const raw = process.env.PAYMENT_ALERT_INTEGRATION_DATABASE_URL;
assert.ok(raw, 'Dedicated local integration database URL is required');
assertLocalRehearsalUrl(raw); // Before database connection, Docker or HTTP listeners.

const image = 'ghcr.io/supabase/postgrest:v16.5@sha256:f3f2a7541965792e51717d10341e09971ea41409dd38e12ea0453042a750c00e';
const container = `parkshare-alert-${randomUUID()}`;
const report = {sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  runtime:'disposable PostgreSQL 17 and pinned PostgREST 16.5', provider:'loopback HTTP simulator',
  hostedDatabaseUsed:false, externalEmailSent:false, financialApiCalled:false, checks:[]};
const check = name => report.checks.push({name,status:'passed'});
const client = new pg.Client({connectionString:raw,connectionTimeoutMillis:5000});
const servers = [], requests = [], messages = new Map();
let stage = 'local database guard', containerStarted = false, connected = false, providerFailures = 0;
const localFetch = async (url, options) => {
  const u = new URL(url);
  assert.equal(u.hostname,'127.0.0.1','Integration HTTP must remain on loopback');
  requests.push({method:options?.method || 'GET',path:u.pathname});
  return fetch(url, {...options,signal:options?.signal || AbortSignal.timeout(5000)});
};
const listen = async server => {
  servers.push(server);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return `http://127.0.0.1:${server.address().port}`;
};
const json = (res,status,value) => {res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const body = async req => {
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;assert.ok(bytes<=32768,'Synthetic request too large');chunks.push(chunk);}
  return Buffer.concat(chunks);
};
const noLog = {info(){},warn(){},error(){}};
try {
  await client.connect();connected=true;
  assert.equal((await client.query('select current_database() name')).rows[0].name,'parkshare_test');
  assert.equal((await client.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n,0,
    'Integration requires a fresh empty public schema');
  check('dedicated local database is fresh and empty');
  stage='local roles and empty outbox';
  const password=randomBytes(24).toString('hex'), jwtSecret=randomBytes(48).toString('hex');
  await client.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin;
    create role payment_alert_authenticator login noinherit nocreatedb nocreaterole nosuperuser password ${literal(password)};
    grant anon,authenticated,service_role to payment_alert_authenticator;
    grant usage on schema public to anon,authenticated;`);
  await client.query(await readFile(new URL('../docs/sql-proposals/payment-emergency-alert-outbox.sql',import.meta.url),'utf8'));
  const token = role => {
    const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const claims=Buffer.from(JSON.stringify({role,iss:'synthetic-local-integration',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
    return `${header}.${claims}.${createHmac('sha256',jwtSecret).update(`${header}.${claims}`).digest('base64url')}`;
  };
  const serviceToken=token('service_role');
  const database = new URL(raw);database.username='payment_alert_authenticator';database.password=password;
  stage='pinned loopback database API';
  execFileSync('docker',['run','--detach','--rm','--network','host','--name',container,
    '--env','PGRST_DB_URI','--env','PGRST_JWT_SECRET','--env','PGRST_DB_SCHEMAS=public',
    '--env','PGRST_DB_ANON_ROLE=anon','--env','PGRST_SERVER_HOST=127.0.0.1',
    '--env','PGRST_SERVER_PORT=3301',image],
  {stdio:['ignore','pipe','pipe'],env:{...process.env,PGRST_DB_URI:database.toString(),PGRST_JWT_SECRET:jwtSecret},timeout:120_000});
  containerStarted=true;
  const restOrigin='http://127.0.0.1:3301';
  let ready=false;
  for(let n=0;n<40;n++){
    try {const r=await localFetch(restOrigin+'/',{headers:{Authorization:`Bearer ${serviceToken}`}});if(r.ok){ready=true;break;}}
    catch {}
    await pause(250);
  }
  assert.ok(ready,'Local database API did not become ready');
  check('pinned database API starts with a non-superuser authenticator');
  // Only a path-prefix gateway is emulated; database requests and role/RLS
  // decisions are handled by the real PostgREST server and PostgreSQL.
  const gatewayOrigin=await listen(createServer(async(req,res)=>{
    try {
      if(!req.url.startsWith('/rest/v1/'))return json(res,404,{error:'Local gateway route not found'});
      const bytes=await body(req),headers={...req.headers};
      for(const key of ['host','connection','content-length'])delete headers[key];
      const upstream=await localFetch(restOrigin+req.url.slice('/rest/v1'.length),{
        method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:bytes})});
      res.statusCode=upstream.status;
      for(const key of ['content-type','content-range','preference-applied','www-authenticate']){
        const value=upstream.headers.get(key);if(value)res.setHeader(key,value);
      }
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {json(res,502,{error:'Local gateway unavailable'});}
  }));
  const sdkOptions={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:localFetch}};
  const db=createClient(gatewayOrigin,serviceToken,sdkOptions);
  const env={PAYMENT_ALERTS_ENABLED:'true',PAYMENT_ALERTS_ENVIRONMENT:'qa',
    PAYMENT_ALERT_EMAIL_TO:'operator@example.invalid',EMAIL_FROM:'ParkShare QA <qa@myparkshare.ca>',
    RESEND_API_KEY:'re_synthetic_only',SUPABASE_SERVICE_ROLE_KEY:serviceToken,STRIPE_SECRET_KEY:'sk_test_synthetic_only',
    VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC',
    SUPABASE_URL:'https://heqxirlsorcztsawaldg.supabase.co'};
  // Environment identity labels are synthetic. The injected SDK client is
  // loopback-only and never constructed from the hosted identity URL above.
  const reporter=createPaymentAlertReporter({env,db,logger:noLog});
  const mailRequests=[];
  const mailOrigin=await listen(createServer(async(req,res)=>{
    try {
      assert.equal(req.method,'POST');assert.equal(req.url,'/emails');
      const bytes=await body(req),payload=JSON.parse(bytes.toString()),key=req.headers['idempotency-key'];
      assert.deepEqual(payload.to,['operator@example.invalid']);assert.match(payload.subject,/\[ParkShare TEST\]/);
      assert.doesNotMatch(payload.text,/SYNTHETIC_PRIVATE_INCIDENT/);
      mailRequests.push({key,body:bytes.toString()});
      if(providerFailures>0){providerFailures--;return json(res,503,{name:'synthetic_provider_unavailable'});}
      const previous=messages.get(key);
      if(previous&&previous.body!==bytes.toString())return json(res,409,{name:'invalid_idempotent_request'});
      const saved=previous || {body:bytes.toString(),id:randomUUID()};messages.set(key,saved);
      return json(res,200,{id:saved.id});
    } catch {return json(res,400,{name:'invalid_synthetic_request'});}
  }));
  const mailFetch = (url,options) => {
    assert.equal(url,'https://api.resend.com/emails');
    return localFetch(mailOrigin+'/emails',options);
  };
  const webhookSource=await readFile(new URL('../api/stripe-webhook.js',import.meta.url),'utf8');
  const rawSource=webhookSource.slice(webhookSource.indexOf('function readRawBody('),webhookSource.indexOf('// "Today"'));
  const readRawBody=new Function(rawSource+';return readRawBody;')();
  const webhookCode=webhookSource.slice(webhookSource.indexOf('export default async function handler'))
    .replace('export default async function handler','return async function handler');
  const signatureSecret='whsec_synthetic_local_integration',cronSecret=randomBytes(24).toString('hex');
  const stripe=new Stripe('sk_test_synthetic_only');
  const webhook=new Function('stripe','readRawBody','processPaidCheckout','reportPaymentAlert','paidCheckoutReferenceLog','process','console',webhookCode)
    (stripe,readRawBody,async()=>{throw new Error('SYNTHETIC_PRIVATE_INCIDENT');},reporter,()=>null,
      {env:{STRIPE_WEBHOOK_SECRET:signatureSecret}},noLog);
  const workerSource=await readFile(new URL('../api/send-payment-alerts.js',import.meta.url),'utf8');
  const workerCode=workerSource.slice(workerSource.indexOf('export default async function handler'))
    .replace('export default async function handler','return async function handler');
  const worker=new Function('supabaseAdmin','drainPaymentAlerts','timingSafeEqual','process',workerCode)
    (db,options=>drainPaymentAlerts({...options,env,fetchImpl:mailFetch}),timingSafeEqual,{env:{CRON_SECRET:cronSecret}});
  const applicationOrigin=await listen(createServer(async(req,res)=>{
    res.status=n=>{res.statusCode=n;return res;};res.json=value=>{json(res,res.statusCode,value);return res;};
    res.send=value=>{res.end(value);return res;};
    try {
      if(req.url==='/application-webhook')await webhook(req,res);
      else if(req.url==='/worker')await worker(req,res);
      else json(res,404,{error:'Unknown synthetic route'});
    } catch {json(res,500,{error:'Local handler unavailable'});}
  }));
  const delivery = async (suffix,valid=true) => {
    const event={id:`evt_synthetic_alert_${suffix}`,type:'checkout.session.completed',livemode:false,account:'acct_synthetic_alert',
      data:{object:{id:`cs_test_synthetic_alert_${suffix}`,payment_status:'paid',livemode:false}}};
    const payload=JSON.stringify(event);
    return localFetch(applicationOrigin+'/application-webhook',{method:'POST',headers:{'Content-Type':'application/json',
      'stripe-signature':valid?stripe.webhooks.generateTestHeaderString({payload,secret:signatureSecret}):'invalid'},body:payload});
  };
  const runWorker = async (valid=true) => {
    const response=await localFetch(applicationOrigin+'/worker',{headers:{Authorization:valid?`Bearer ${cronSecret}`:'Bearer invalid'}});
    return {status:response.status,body:await response.json()};
  };
  const rows=async()=> (await client.query('select * from public.payment_alert_deliveries order by created_at')).rows;
  stage='invalid signatures and worker authorization';
  assert.equal((await delivery('unsigned',false)).status,400);assert.equal((await runWorker(false)).status,401);
  assert.equal((await rows()).length,0);assert.equal(mailRequests.length,0);
  check('unsigned incidents and unauthorized worker requests perform no queue or email action');
  stage='application to database API to durable queue';
  assert.equal((await delivery('success')).status,500);
  let saved=await rows();assert.equal(saved.length,1);assert.equal(saved[0].first_attempt_at,null);assert.equal(mailRequests.length,0);
  check('signed application failure retains HTTP 500 and persists one redacted alert through the real SDK/API');
  stage='authenticated worker to simulated email provider';
  let drained=await runWorker();assert.equal(drained.status,200);assert.equal(drained.body.accepted,1);
  saved=await rows();assert.ok(saved[0].accepted_at);assert.ok(saved[0].provider_id);assert.equal(saved[0].attempts,1);
  assert.equal(messages.size,1);
  check('authenticated worker claims, sends and records provider acceptance through real database requests');
  stage='signed replay and accepted-job deduplication';
  assert.equal((await delivery('success')).status,500);assert.equal((await runWorker()).body.accepted,0);
  assert.equal((await rows()).length,1);assert.equal(mailRequests.length,1);
  check('replayed incident creates no second row or provider message');
  stage='transient email failure and persisted backoff';
  await delivery('retry');providerFailures=1;
  drained=await runWorker();assert.equal(drained.body.pending,1);assert.equal(drained.body.failed,0);
  const pending=(await rows()).find(r=>!r.accepted_at),attemptCount=mailRequests.length;
  assert.ok(pending.first_attempt_at);assert.equal(pending.attempts,1);assert.ok(+pending.next_attempt_at>Date.now());
  assert.equal((await runWorker()).body.pending,0);assert.equal(mailRequests.length,attemptCount);
  await client.query("update public.payment_alert_deliveries set next_attempt_at=now()-interval '1 second' where id=$1",[pending.id]);
  assert.equal((await runWorker()).body.accepted,1);
  assert.equal(mailRequests.at(-1).key,mailRequests.at(-2).key);assert.equal(mailRequests.at(-1).body,mailRequests.at(-2).body);
  check('transient failure persists backoff and retries the exact saved body/key without inline waiting');
  stage='crashed worker lease recovery';
  await delivery('lease');const leased=(await rows()).find(r=>!r.accepted_at);
  const claim=await db.rpc('claim_payment_alert',{p_id:leased.id,p_token:randomUUID(),p_livemode:false});assert.equal(claim.error,null);
  assert.equal((await runWorker()).body.accepted,0);
  await client.query("update public.payment_alert_deliveries set lease_until=now()-interval '1 second' where id=$1",[leased.id]);
  assert.equal((await runWorker()).body.accepted,1);assert.equal((await rows()).find(r=>r.id===leased.id).attempts,2);
  check('a crashed worker lease is not stolen early and is recoverable after expiry');
  stage='expired ambiguous send cutoff';
  await delivery('expired');const expired=(await rows()).find(r=>!r.accepted_at);
  await client.query("update public.payment_alert_deliveries set first_attempt_at=now()-interval '23 hours' where id=$1",[expired.id]);
  const beforeExpiry=mailRequests.length;assert.equal((await runWorker()).body.blocked,1);assert.equal(mailRequests.length,beforeExpiry);
  assert.equal((await rows()).find(r=>r.id===expired.id).last_error_code,'idempotency_window_expired');
  check('expired ambiguous notification blocks before any provider request');
  stage='API role and JWT isolation';
  for(const role of ['anon','authenticated']){
    const other=createClient(gatewayOrigin,token(role),sdkOptions);
    assert.ok((await other.from('payment_alert_deliveries').select('id')).error);
    const denied=await other.rpc('enqueue_payment_alert',{p_key:saved[0].idempotency_key,p_kind:saved[0].kind,p_livemode:false,p_payload:saved[0].payload});
    assert.ok(denied.error);
  }
  const forged=await localFetch(gatewayOrigin+'/rest/v1/payment_alert_deliveries?select=id',{headers:{Authorization:`Bearer ${serviceToken.slice(0,-5)}xxxxx`}});
  assert.equal(forged.status,401);
  check('real API denies anonymous/authenticated queue access and forged service JWTs');
  stage='mode separation and stale acknowledgement';
  assert.equal((await reporter('refund_failed',{eventId:'evt_synthetic_wrong_mode',livemode:true})).status,'invalid_alert');
  const stale=await db.rpc('finish_payment_alert',{p_id:saved[0].id,p_token:randomUUID(),p_outcome:'blocked',p_code:'provider_rejected'});
  assert.equal(stale.error,null);assert.equal(stale.data,false);
  check('wrong-mode incidents and stale acknowledgements cannot change accepted state');
  const final=await rows();assert.equal(final.length,4);assert.equal(final.filter(j=>j.accepted_at).length,3);
  assert.equal(final.filter(j=>j.blocked_at).length,1);assert.equal(messages.size,3);
  assert.deepEqual((await client.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows,
    [{tablename:'payment_alert_deliveries'}]);
  check('only the synthetic outbox exists; no bookings or financial tables are created');
  report.summary={queued:4,accepted:3,blocked:1,uniqueSimulatedMessages:messages.size,loopbackHttpRequests:requests.length};
  report.postgrestImage=image;report.status='passed';
  console.log(`PASS: ${report.checks.length} isolated alert-flow checks; no external sends or hosted changes.`);
} catch(error) {
  report.status='failed';report.error={stage,code:/^[A-Z0-9_]+$/.test(error?.code || '')?error.code:null};
  console.error('Isolated alert flow failed at:',stage);process.exitCode=1;
} finally {
  for(const server of servers.reverse())await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  if(containerStarted)try {execFileSync('docker',['rm','-f',container],{stdio:'ignore',timeout:10_000});}catch {}
  if(connected)await client.end();
  await writeFile('payment-alert-integration-results.json',JSON.stringify(report,null,2)+'\n');
}
