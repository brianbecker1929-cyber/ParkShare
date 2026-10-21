import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
process.env.APP_URL='https://parkshare-qa.vercel.app';
process.env.SUPABASE_URL='https://sample.invalid';
process.env.SUPABASE_ANON_KEY='synthetic';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
process.env.STRIPE_SECRET_KEY='sk_test_synthetic';
process.env.RESEND_API_KEY='synthetic';
process.env.EMAIL_FROM='ParkShare <test@example.invalid>';
process.env.CRON_SECRET='synthetic-cron';
const {processRefundEmail}=await import('../api/_refund-email-delivery.js');
const {refundConfirmedHtml}=await import('../api/_email.js');
const {default:handler}=await import('../api/send-refund-notifications.js');
const {default:preview}=await import('../api/preview-refund-email.js');
const originalFetch=globalThis.fetch;
const clock=Date.now();

function fixture({audience='driver',extension=false,status='refunded',cancelledBy='driver',reason='Plans changed'}={}) {
  const state={calls:[],acceptanceError:false,providerError:false,missingEmail:false,lookupError:false};
  state.job={id:'10000000-0000-4000-8000-000000000001',connected_account_id:'acct_host',livemode:false,refund_id:'re_one',booking_id:42,audience,payload:null,first_attempt_at:null,sent_at:null,blocked_at:null,lease_until:new Date(0).toISOString()};
  state.refund={connected_account_id:'acct_host',livemode:false,refund_id:'re_one',booking_id:extension?null:42,extension_id:extension?5:null,payment_intent_id:extension?'pi_extension':'pi_booking',currency:'cad',amount_cents:1235,status:'succeeded'};
  state.booking={id:42,listing_id:7,renter_id:'driver',status,total:12.35,cancelled_by:cancelledBy,cancellation_reason:reason,hours:1,paid_at:'2026-10-21T10:00:00Z',scheduled_starts_at:'2026-10-22T12:00:00Z',property_time_zone:'Europe/Bucharest',spot_label:'F',vehicle_make:'INFINITI',vehicle_model:'Q30',vehicle_colour:'Yellow',license_plate:'DEMO 123',stripe_connected_account_id:'acct_host',stripe_payment_intent_id:'pi_booking'};
  state.extension={id:5,booking_id:42,added_amount:12.35,stripe_connected_account_id:'acct_host',stripe_payment_intent_id:'pi_extension'};
  state.listing={id:7,host_id:'host',address:'12 Example Crescent'};
  const db={from(table){let verb='get',body,filters=[],singular=false,selected=false;
    const q={
      select(fields){selected=fields;return q;},update(v){verb='update';body=v;return q;},
      eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},lte(k,v){filters.push([k,{lte:v}]);return q;},
      single(){singular=true;return q;},maybeSingle(){singular=true;return q;},
      then(resolve,reject){
        try {
          let row=table==='refund_email_deliveries'?state.job:table==='payment_refunds'?state.refund:table==='bookings'?state.booking:table==='booking_extensions'?state.extension:table==='listings'?state.listing:table==='profiles'?{id:filters.find(f=>f[0]==='id')?.[1],name:audience==='host'?'Host <test>':'Driver <test>',email:state.missingEmail?null:`${audience}@example.invalid`}:null;
          if (!row) throw Error('Unexpected table '+table);
          const matches=filters.every(([k,v])=>typeof v==='object' && v?.lte ? Date.parse(row[k])<=Date.parse(v.lte) : row[k]===v);
          if (state.lookupError && table==='profiles') return Promise.resolve({error:{code:'synthetic'}}).then(resolve,reject);
          if (verb==='update' && matches) {
            if (body.provider_id && state.acceptanceError) return Promise.resolve({error:{code:'synthetic'}}).then(resolve,reject);
            Object.assign(row,body);
          }
          const data=matches && (verb==='get'||selected)?structuredClone(selected?Object.fromEntries(selected.split(',').map(k=>[k.trim(),row[k.trim()]])):row):null;
          return Promise.resolve({error:null,data:singular?data:data?[data]:[]}).then(resolve,reject);
        } catch(e) {return Promise.reject(e).then(resolve,reject);}
      },
    };return q;
  }};
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://api.resend.com/emails');
    state.calls.push({payload:JSON.parse(init.body),key:init.headers['Idempotency-Key']});
    if(state.providerError)return Response.json({message:'synthetic failure'},{status:503});
    return Response.json({id:'email_receipt'});
  };
  return {db,state};
}
test.afterEach(()=>{globalThis.fetch=originalFetch;});
for(const audience of ['driver','host']) test(`${audience} receives an isolated accurate cancellation receipt on QA`,async()=>{
  const {db,state}=fixture({audience});
  assert.equal(await processRefundEmail(db,state.job),'sent');
  assert.equal(state.calls.length,1);
  const {payload,key}=state.calls[0];
  assert.deepEqual(payload.to,[`${audience}@example.invalid`]);assert.equal(payload.cc,undefined);
  assert.match(payload.subject,/PK-42 cancelled/);
  assert.match(payload.html,/BOOKING CANCELLED/);
  assert.ok(payload.html.includes('Cancelled by: Driver.'));
  assert.ok(payload.html.includes('Cancellation reason: Plans changed'));
  assert.ok(payload.html.indexOf('Cancellation reason: Plans changed') < payload.html.indexOf('Hi <strong>'));
  for(const value of ['$12.35','re_one','PK-42','Spot F','Q30','DEMO 123','Europe/Bucharest local time','This booking is cancelled.'])assert.ok(payload.html.includes(value),value);
  assert.ok(payload.html.includes('REFUND'));assert.ok(payload.html.includes('CONFIRMED'));
  assert.match(payload.html,/&lt;test&gt;/);assert.doesNotMatch(payload.html,/<test>|\[[A-Z_]+\]|https:\/\/www\.myparkshare\.ca/);
  assert.ok(payload.html.includes(audience==='host'?'parkshare-william-portrait.png':'parkshare-parker-portrait.png'));
  assert.ok(payload.html.includes(audience==='host'?'https://parkshare-qa.vercel.app/host-dashboard':'https://parkshare-qa.vercel.app/my-bookings'));
  assert.match(key,/^parkshare-refund-[a-f0-9]{64}$/);
  assert.equal(state.job.provider_id,'email_receipt');assert.ok(state.job.sent_at);
});
test('partial refund and extension refund do not claim cancellation or add parking time',async()=>{
  for(const extension of [false,true]){
    const {db,state}=fixture({status:'confirmed',extension});
    await processRefundEmail(db,state.job);
    const {html,subject}=state.calls[0].payload;
    assert.doesNotMatch(subject,/cancelled/);assert.ok(html.includes('booking remains confirmed'));
    if(extension)assert.ok(html.includes('an extension payment'));
    assert.ok(html.includes('other charges, including paid extensions, are separate'));
  }
});
for(const audience of ['driver','host']) for(const [cancelledBy,label] of [['driver','Driver'],['host','Host'],['support','ParkShare Support'],['system','ParkShare system'],[null,'Not recorded']]) test(`${audience} receipt identifies recorded ${label} canceller without guessing from the recipient`,async()=>{
  const {db,state}=fixture({audience,cancelledBy,reason:'Event was rescheduled'});await processRefundEmail(db,state.job);
  const {html,subject}=state.calls[0].payload;
  assert.ok(html.includes(`Cancelled by: ${label}.`));assert.ok(html.includes('Cancellation reason: Event was rescheduled'));
  assert.equal(subject,'Booking PK-42 cancelled — refund confirmed');assert.match(html,/<title>ParkShare — Booking cancelled — refund confirmed<\/title>/);
});
test('missing attribution and reason are stated honestly; recorded HTML and placeholder-looking text remain literal',async()=>{
  for(const reason of [null,'','   ']){
    const {db,state}=fixture({cancelledBy:'unknown',reason});await processRefundEmail(db,state.job);
    assert.ok(state.calls[0].payload.html.includes('Cancelled by: Not recorded.'));
    assert.ok(state.calls[0].payload.html.includes('No cancellation reason was recorded.'));
  }
  const {db,state}=fixture({reason:'<img src=x onerror="alert(1)"> & [BOOKING_URL]\nSecond line'});await processRefundEmail(db,state.job);
  const {html}=state.calls[0].payload;assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#91;BOOKING_URL&#93;\nSecond line/);
  assert.doesNotMatch(html,/<img src=x|\[[A-Z_]+\]/);
});
test('individual partial and extension receipts never claim they cancelled a confirmed reservation',async()=>{
  for(const extension of [false,true]) for(const audience of ['driver','host']){
    const {db,state}=fixture({extension,audience,status:'confirmed'});state.refund.amount_cents=500;
    await processRefundEmail(db,state.job);const {html,subject}=state.calls[0].payload;
    assert.match(subject,/^Partial/);assert.ok(html.includes('$5.00 CAD'));assert.ok(html.includes('booking remains confirmed'));
    assert.doesNotMatch(html,/BOOKING CANCELLED|Cancelled by:|Cancellation reason:/);assert.doesNotMatch(subject,/cancelled/);
    if(extension)assert.ok(html.includes('PARTIAL EXTENSION'));
  }
});
test('a partial receipt after cancellation names both facts without claiming every payment was refunded',async()=>{
  const {db,state}=fixture({cancelledBy:'host',reason:'Driveway unavailable'});state.refund.amount_cents=500;
  await processRefundEmail(db,state.job);const {html,subject}=state.calls[0].payload;
  assert.equal(subject,'Booking PK-42 cancelled — partial refund confirmed');
  for(const value of ['BOOKING CANCELLED','PARTIAL REFUND CONFIRMED','Cancelled by: Host.','Cancellation reason: Driveway unavailable','$5.00 CAD'])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/full refund|all charges.*refunded/i);
});
test('extension refund after parent cancellation stays an extension receipt rather than attributing its refund to the canceller',async()=>{
  const {db,state}=fixture({extension:true,cancelledBy:'host'});await processRefundEmail(db,state.job);
  const {html,subject}=state.calls[0].payload;assert.equal(subject,'Extension refund confirmed for booking PK-42');
  assert.ok(html.includes('EXTENSION REFUND'));assert.ok(html.includes('This booking is cancelled.'));
  assert.doesNotMatch(html,/BOOKING CANCELLED|Cancelled by:|Cancellation reason:/);
});
test('duplicate and overlapping workers make one provider request',async()=>{
  const {db,state}=fixture();
  const outcomes=await Promise.all([processRefundEmail(db,state.job),processRefundEmail(db,state.job)]);
  assert.equal(outcomes.filter(v=>v==='sent').length,1);assert.equal(state.calls.length,1);
  assert.equal(await processRefundEmail(db,state.job),'busy');assert.equal(state.calls.length,1);
});
test('an unknown acceptance retries exactly the saved provider request and key',async()=>{
  const {db,state}=fixture();state.acceptanceError=true;
  await assert.rejects(processRefundEmail(db,state.job),/acceptance/);
  assert.equal(state.job.sent_at,null);assert.equal(state.calls.length,1);
  assert.equal(await processRefundEmail(db,state.job),'busy');
  state.acceptanceError=false;state.listing.address='changed after acceptance';state.booking.status='confirmed';
  await processRefundEmail(db,state.job,{now:new Date(clock+121000)});
  assert.equal(state.calls.length,2);assert.deepEqual(state.calls[0],state.calls[1]);
});
test('provider errors keep delivery pending for retry',async()=>{
  const {db,state}=fixture();state.providerError=true;
  await assert.rejects(processRefundEmail(db,state.job),/503/);
  assert.equal(state.job.sent_at,null);assert.equal(state.job.provider_id,undefined);
  state.providerError=false;
  await processRefundEmail(db,state.job,{now:new Date(clock+121000)});
  assert.deepEqual(state.calls[0],state.calls[1]);
});
for(const missing of ['missingEmail','lookupError']) test(`${missing} cannot count as sent`,async()=>{
  const {db,state}=fixture();state[missing]=true;
  await assert.rejects(processRefundEmail(db,state.job),/unavailable|failed/);
  assert.equal(state.calls.length,0);assert.equal(state.job.sent_at,null);
});
for(const status of ['pending','failed','canceled','requires_action']) test(`${status} refund cannot produce success mail`,async()=>{
  const {db,state}=fixture();state.refund.status=status;
  assert.equal(await processRefundEmail(db,state.job),'blocked');assert.equal(state.calls.length,0);assert.ok(state.job.blocked_at);
});
test('mismatched extension and base payment owners are rejected',async()=>{
  for(const extension of [false,true]){
    const {db,state}=fixture({extension});
    if(extension)state.extension.booking_id=999;else state.refund.connected_account_id='acct_foreign';
    // Preserve filter identity for the base case but mismatch the immutable payment.
    if(!extension){state.refund.connected_account_id='acct_host';state.refund.payment_intent_id='pi_foreign';}
    await assert.rejects(processRefundEmail(db,state.job),/owner mismatch/);assert.equal(state.calls.length,0);
  }
});
test('expired idempotency window requires reconciliation, never blindly resends',async()=>{
  const {db,state}=fixture();state.acceptanceError=true;
  await assert.rejects(processRefundEmail(db,state.job),/acceptance/);state.acceptanceError=false;
  state.job.first_attempt_at=new Date(clock-23*3600_000).toISOString();state.job.lease_until=new Date(0).toISOString();
  assert.equal(await processRefundEmail(db,state.job),'blocked');assert.equal(state.calls.length,1);
});
test('no provider acceptance ID cannot count as success',async()=>{
  const {db,state}=fixture();
  await assert.rejects(processRefundEmail(db,state.job,{send:async()=>({skipped:true})}),/not accepted/);
  assert.equal(state.job.sent_at,null);
});
test('refund cron is authenticated, uncached and configured every minute alongside reminders',async()=>{
  let code,body;const headers={};const res={setHeader(k,v){headers[k]=v;},status(c){code=c;return this;},json(v){body=v;return this;}};
  for(const [method,authorization,expected] of [['GET','',401],['GET','Bearer wrong',401],['POST','Bearer synthetic-cron',405]]){
    await handler({method,headers:{authorization}},res);assert.equal(code,expected);
  }
  assert.equal(headers['Cache-Control'],'private, no-store');
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  for(const path of ['/api/send-refund-notifications','/api/send-reminders'])assert.ok(config.crons.some(c=>c.path===path&&c.schedule==='* * * * *'));
});
test('authorized cron scans test-mode pending work and surfaces queue read errors',async()=>{
  let body,code;const res={setHeader(){},status(c){code=c;return this;},json(v){body=v;return this;}};
  let scans=0;
  globalThis.fetch=async input=>{
    const url=new URL(input instanceof Request?input.url:input);
    assert.equal(url.hostname,'sample.invalid');assert.ok(url.pathname.endsWith('/refund_email_deliveries'));
    assert.equal(url.searchParams.get('livemode'),'eq.false');
    assert.equal(url.searchParams.get('sent_at'),'is.null');assert.equal(url.searchParams.get('blocked_at'),'is.null');
    assert.equal(url.searchParams.get('limit'),'10');scans++;return Response.json([]);
  };
  await handler({method:'GET',headers:{authorization:'Bearer synthetic-cron'}},res);
  assert.equal(code,200);assert.deepEqual(body,{sent:0,busy:0,blocked:0,failed:0});assert.equal(scans,1);
  globalThis.fetch=async()=>Response.json({message:'synthetic db failure'},{status:400});
  await handler({method:'GET',headers:{authorization:'Bearer synthetic-cron'}},res);assert.equal(code,500);
});
test('read-only refund previews cover cancellation, partial and extension wording at desktop and narrow widths',async()=>{
  const prior=process.env.VERCEL_ENV;process.env.VERCEL_ENV='preview';
  globalThis.fetch=()=>{throw Error('Previews must never read or send remotely');};
  try{
    for(const scenario of ['driver','host','unknown','partial','cancelled_partial','extension','extension_partial','long_reason']) for(const audience of ['driver','host']){
      const res={code:200,headers:{},status(n){this.code=n;return this;},setHeader(k,v){this.headers[k]=v;},send(v){this.body=v;return this;},end(v){this.body=v;return this;}};
      await preview({method:'GET',query:{scenario,audience}},res);assert.equal(res.code,200);assert.ok(res.body.includes('SAMPLE BOOKING · NO EMAIL SENT'));assert.doesNotMatch(res.body,/\[[A-Z_]+\]/);
      assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers['X-Robots-Tag'],'noindex, nofollow');
      if(['driver','host','unknown','cancelled_partial','long_reason'].includes(scenario))assert.ok(res.body.includes('BOOKING CANCELLED'));else assert.doesNotMatch(res.body,/BOOKING CANCELLED/);
      for(const width of ['320','375','390']){await preview({method:'GET',query:{scenario,audience,width}},res);assert.ok(res.body.includes(`width:${width}px`));assert.ok(res.body.includes('srcdoc="&lt;!DOCTYPE html&gt;'));}
    }
    const res={status(n){this.code=n;return this;},setHeader(){},end(){return this;}};
    await preview({method:'POST',query:{}},res);assert.equal(res.code,405);
    process.env.VERCEL_ENV='production';await preview({method:'GET',query:{}},res);assert.equal(res.code,404);
  }finally{if(prior===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prior;}
});
