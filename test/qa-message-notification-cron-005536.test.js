import test, {before, beforeEach, after, mock} from 'node:test';
import assert from 'node:assert/strict';
Object.assign(process.env, {STRIPE_SECRET_KEY:'sk_test_cron_fixture',SUPABASE_URL:'https://chat-cron.invalid',
  SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',
  RESEND_API_KEY:'fixture-email',EMAIL_FROM:'ParkShare <qa@example.invalid>',CRON_SECRET:'fixture-cron',APP_URL:'https://qa.example.invalid'});
let handler, rows, requests, dbCalls, providerFailure, queueFailure;
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
const request=async(headers={authorization:'Bearer fixture-cron'},method='GET')=>{const res=response();await handler({method,headers},res);return res;};
before(async()=>{
  mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(input instanceof Request?input.url:input),method=options.method||'GET';
    if(url.origin==='https://api.resend.com') {
      assert.equal(url.pathname,'/emails');requests.push({body:JSON.parse(options.body),key:new Headers(options.headers).get('idempotency-key')});
      return providerFailure?Response.json({message:'synthetic failure'},{status:503}):Response.json({id:'provider-fixture'});
    }
    assert.equal(url.origin,'https://chat-cron.invalid','No real network request is allowed');dbCalls++;
    const table=url.pathname.split('/').at(-1);
    if(table==='bookings') return Response.json([]);
    if(table==='message_email_deliveries'&&queueFailure)return Response.json({message:'synthetic database error'},{status:500});
    assert.ok(rows[table],table);
    let selected=rows[table].filter(row=>[...url.searchParams].every(([key,value])=>{
      if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
      if(value==='is.null')return row[key]===null;
      if(value.startsWith('lte.'))return row[key]==='-infinity'||Date.parse(row[key])<=Date.parse(value.slice(4));
      return true;
    }));
    if(url.searchParams.has('limit')) selected=selected.slice(0,Number(url.searchParams.get('limit')));
    if(method==='PATCH')selected.forEach(row=>Object.assign(row,JSON.parse(options.body)));
    else assert.equal(method,'GET');
    const columns=url.searchParams.get('select')?.split(',');
    const projected=selected.map(row=>columns?Object.fromEntries(columns.map(column=>[column,row[column]??null])):row);
    const single=new Headers(options.headers).get('accept')?.includes('object+json');
    return Response.json(single?projected[0]??null:projected);
  });
  ({default:handler}=await import('../api/send-reminders.js'));
});
beforeEach(()=>{
  requests=[];dbCalls=0;providerFailure=false;queueFailure=false;
  rows={message_email_deliveries:[{message_id:1,created_at:new Date().toISOString(),lease_until:'-infinity',sent_at:null,blocked_at:null,payload:null,first_attempt_at:null}],
    messages:[{id:1,listing_id:7,booking_id:null,sender_id:'driver',recipient_id:'host',text:'PRIVATE MESSAGE'}],
    listings:[{id:7,host_id:'host'}],profiles:[{id:'host',email:'host@example.invalid'}]};
});
after(()=>mock.restoreAll());

test('actual protected minute endpoint sends one recipient-only chat notice even when no reminders are due',async()=>{
  const result=await request();assert.equal(result.code,200);assert.deepEqual(result.body,{halfwaySent:0,endingSent:0,failed:0,messages:{accepted:1,failed:0,blocked:0}});
  assert.equal(requests.length,1);assert.deepEqual(requests[0].body.to,['host@example.invalid']);assert.match(requests[0].key,/^parkshare-message-/);
  assert.ok(!JSON.stringify(requests[0].body).includes('PRIVATE MESSAGE'));assert.ok(!requests[0].body.cc);assert.ok(!requests[0].body.bcc);assert.ok(!requests[0].body.reply_to);
  assert.match(requests[0].body.html,/https:\/\/qa.example.invalid\/messages/);assert.equal(rows.message_email_deliveries[0].provider_id,'provider-fixture');
  assert.deepEqual((await request()).body,{halfwaySent:0,endingSent:0,failed:0});assert.equal(requests.length,1);
});
test('signed-out, wrong-secret and unsupported-method requests never touch the database or provider',async()=>{
  assert.equal((await request({})).code,401);assert.equal((await request({authorization:'Bearer wrong'})).code,401);assert.equal((await request({},'DELETE')).code,405);
  assert.equal(dbCalls,0);assert.equal(requests.length,0);
});
test('provider failure retains the frozen retry job and remains visible without breaking the reminder response',async()=>{
  providerFailure=true;const first=await request();assert.equal(first.code,200);assert.deepEqual(first.body.messages,{accepted:0,failed:1,blocked:0});assert.equal(rows.message_email_deliveries[0].sent_at,null);
  rows.message_email_deliveries[0].lease_until='-infinity';providerFailure=false;const retry=await request();assert.equal(retry.body.messages.accepted,1);assert.deepEqual(requests[0],requests[1]);
});
test('queue lookup failure is reported separately and does not disguise successful session reminder processing',async()=>{
  queueFailure=true;const result=await request();assert.equal(result.code,200);assert.equal(result.body.failed,0);assert.equal(result.body.messages.failed,1);assert.equal(requests.length,0);
});
