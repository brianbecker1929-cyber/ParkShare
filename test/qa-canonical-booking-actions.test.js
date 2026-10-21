import assert from 'node:assert/strict';
import {after,before,beforeEach,mock,test} from 'node:test';
import {resolveLocalBookingStart} from '../api/_booking-local-time.js';
process.env.APP_URL='https://parkshare-qa.vercel.app';
process.env.STRIPE_SECRET_KEY='sk_test_booking_actions_fixture';
process.env.SUPABASE_URL='https://booking-actions.invalid';
process.env.SUPABASE_ANON_KEY='booking-actions-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY='booking-actions-service';
const DRIVER='00000000-0000-4000-8000-000000000022',HOST='00000000-0000-4000-8000-000000000021',OTHER='00000000-0000-4000-8000-000000000023';
let extend,review,booking,actor,requests,charges,holds,reviews,availabilityReads,reviewError,lib;
const project=(row,select)=>Object.fromEntries(select.split(',').map(k=>[k.trim(),row[k.trim()]??null]));
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},setHeader(){},json(body){this.body=body;return this;}});
function schedule(zone='America/Toronto',date='2026-10-20',hour=9,hours=2){
 const start=resolveLocalBookingStart({bookingDate:date,startHour:hour,timeZone:zone});
 booking={id:221,listing_id:11,renter_id:DRIVER,hours,status:'confirmed',paid_at:'2026-10-01T01:00:00Z',booking_date:date,start_hour:hour,
  scheduled_starts_at:start.toISOString(),property_time_zone:zone,spot_label:'A',stripe_checkout_session_id:'cs_paid_fixture'};
 return {start:+start,end:+start+hours*3600000};
}
async function run(handler,body,auth=true){const res=response();await handler({method:'POST',body,headers:auth?{authorization:'Bearer synthetic'}:{}},res);return res;}
const extension=(auth=true)=>run(extend,{bookingId:221,addedHours:0.5},auth);
const submitReview=(auth=true)=>run(review,{listingId:11,rating:5,text:'Synthetic test review'},auth);
before(async()=>{
 mock.method(globalThis,'fetch',async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url);assert.equal(url.origin,'https://booking-actions.invalid','all live network and Stripe actions must be mocked');
  if(url.pathname==='/auth/v1/user')return Response.json({id:actor,email:'driver@example.invalid',aud:'authenticated',user_metadata:{}});
  const table=url.pathname.split('/').at(-1),method=options.method||'GET';requests.push({table,method,params:url.searchParams});
  if(table==='reserve_extension_checkout_hold'){
   const args=JSON.parse(options.body);holds.push(args);
   const {start,end}=lib.getSessionWindow(booking);
   assert.ok(Date.now()>=+start&&Date.now()<+end,'DB hold would reject inactive bookings');
   return Response.json([{hold_id:'20000000-0000-4000-8000-000000000001',starts_at:end.toISOString(),ends_at:new Date(+end+1800000).toISOString()}]);
  }
  if(table==='reviews'&&method==='POST'){
   if(reviewError)return Response.json({code:reviewError,message:'Synthetic review failure'},{status:409});
   const inserted={id:1,...JSON.parse(options.body),created_at:new Date().toISOString()};reviews.push(inserted);return Response.json(project(inserted,url.searchParams.get('select')));
  }
  if(table==='booking_holds'&&method==='PATCH')return Response.json({id:'20000000-0000-4000-8000-000000000001'});
  if(table==='pending_booking_extensions'&&method==='POST')return Response.json({id:'20000000-0000-4000-8000-000000000002'});
  assert.equal(method,'GET','unexpected write');
  const tables={bookings:[booking],listings:[{id:11,host_id:HOST,title:'Synthetic parking',price:12,spaces:1}],profiles:[{id:HOST,stripe_account_id:'acct_fixture'}],booking_holds:[]};assert.ok(Object.hasOwn(tables,table),table);
  if(table==='bookings'&&!url.searchParams.has('id')&&url.searchParams.get('status')==='eq.confirmed')availabilityReads++;
  let data=tables[table].filter(row=>[...url.searchParams].every(([key,value])=>!value.startsWith('eq.')||String(row[key])===value.slice(3)));
  data=data.map(row=>project(row,url.searchParams.get('select')));
  const accept=new Headers(options.headers).get('accept')||'';return Response.json(accept.includes('application/vnd.pgrst.object+json')?data[0]??null:data);
 });
 lib=await import('../api/_lib.js');
 mock.method(lib.stripe.accounts,'retrieve',async()=>({charges_enabled:true}));
 mock.method(lib.stripe.checkout.sessions,'create',async(...args)=>{charges.push(args);return {id:'cs_extension_fixture',url:'https://checkout.stripe.invalid/synthetic',currency:'cad',amount_total:690,adaptive_pricing:{enabled:false}};});
 mock.method(lib.stripe.checkout.sessions,'expire',async()=>{throw Error('no expiration expected');});
 ({default:extend}=await import('../api/create-extend-session.js'));({default:review}=await import('../api/reviews.js'));
});
beforeEach(()=>{actor=DRIVER;requests=[];charges=[];holds=[];reviews=[];availabilityReads=0;reviewError=null;mock.timers.reset();schedule();mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-20T14:00:00Z')});});
after(()=>{mock.timers.reset();mock.restoreAll();});
for(const [zone,date,hour] of [['America/Toronto','2026-10-20',9],['Europe/Bucharest','2026-10-20',9],['America/Toronto','2026-11-01',1],['Europe/Bucharest','2026-10-25',1],['America/Toronto','2026-10-20',23.5]]){
 // Use an unambiguous pre-transition start; duration remains elapsed hours.
 test(`extension uses saved start, including DST/midnight: ${zone} ${date} ${hour}`,async()=>{
  const window=schedule(zone,date,hour===1&&zone==='America/Toronto'?0.5:hour);mock.timers.setTime(window.start+3600000);
  const res=await extension();assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(charges.length,1);assert.equal(holds.length,1);
  assert.equal(holds[0].p_booking_id,221);assert.equal(charges[0][0].line_items[0].price_data.unit_amount,600);assert.equal(charges[0][0].payment_intent_data.application_fee_amount,90);assert.equal(charges[0][1].stripeAccount,'acct_fixture');
  assert.equal(booking.hours,2,'starting checkout must not grant time before payment');
 });
}
for(const [zone,at] of [['America/Toronto','before'],['America/Toronto','start'],['America/Toronto','end'],['Europe/Bucharest','before'],['Europe/Bucharest','end']]){
 test(`extension boundary ${zone} ${at} is checked before availability and payment`,async()=>{
  const window=schedule(zone);mock.timers.setTime(at==='before'?window.start-1:at==='end'?window.end:window.start);
  const res=await extension();assert.equal(res.statusCode,at==='start'?200:409,JSON.stringify(res.body));if(at!=='start'){assert.equal(charges.length,0);assert.equal(holds.length,0);assert.equal(availabilityReads,0);}
 });
}
for(const [zone,offset,allowed] of [['America/Toronto',-1,false],['America/Toronto',0,true],['Europe/Bucharest',-1,false],['Europe/Bucharest',0,true]]){
 test(`review completion follows the true end: ${zone}, offset ${offset}`,async()=>{
  const window=schedule(zone);mock.timers.setTime(window.end+offset);const res=await submitReview();assert.equal(res.statusCode,allowed?201:403,JSON.stringify(res.body));assert.equal(reviews.length,allowed?1:0);assert.equal(charges.length,0);
 });
}
test('invalid saved instant fails closed without falling back to local hours',async()=>{
 booking.scheduled_starts_at='invalid';mock.timers.setTime(Date.parse('2026-10-20T10:00:00Z'));assert.equal((await extension()).statusCode,500);assert.equal((await submitReview()).statusCode,403);assert.equal(charges.length,0);assert.equal(holds.length,0);assert.equal(reviews.length,0);
});
test('legacy UTC and Book Now interpretation remains unchanged',async()=>{
 for(const immediate of [false,true]){
  Object.assign(booking,{scheduled_starts_at:null,property_time_zone:null,booking_date:immediate?null:'2026-10-20',start_hour:immediate?null:9,paid_at:'2026-10-20T09:00:00Z'});
  mock.timers.setTime(Date.parse('2026-10-20T10:00:00Z'));assert.equal((await extension()).statusCode,200);assert.equal((await submitReview()).statusCode,403);
  mock.timers.setTime(Date.parse('2026-10-20T11:00:00Z'));assert.equal((await submitReview()).statusCode,201);
 }
});
test('authentication, ownership and self-review controls still precede writes',async()=>{
 assert.equal((await extension(false)).statusCode,401);assert.equal((await submitReview(false)).statusCode,401);actor=OTHER;assert.equal((await extension()).statusCode,403);actor=HOST;assert.equal((await submitReview()).statusCode,403);assert.equal(charges.length,0);assert.equal(holds.length,0);assert.equal(reviews.length,0);
});
test('paid extension hours extend the review cutoff and extension interval',async()=>{
 const window=schedule();booking.hours=3;mock.timers.setTime(window.end+1800000);assert.equal((await submitReview()).statusCode,403);assert.equal((await extension()).statusCode,200);
});
test('duplicate review remains a 409 after actual completion',async()=>{
 const window=schedule();mock.timers.setTime(window.end);reviewError='23505';assert.equal((await submitReview()).statusCode,409);assert.equal(reviews.length,0);
});
