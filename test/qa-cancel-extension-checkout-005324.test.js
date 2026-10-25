import assert from 'node:assert/strict';
import {after,before,beforeEach,mock,test} from 'node:test';

process.env.STRIPE_SECRET_KEY='sk_test_extension_cancel_fixture';
process.env.SUPABASE_URL='https://extension-cancel.invalid';
process.env.SUPABASE_ANON_KEY='synthetic-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service';
const ID='10000000-0000-4000-8000-000000000001',OWNER='00000000-0000-4000-8000-000000000011';
let handler,accountHandler,lib,tables,actor,session,provider,rpcs,reads,dbError,expireError,afterExpiry,rpcFalse;
const result=()=>({statusCode:200,headers:{},status(n){this.statusCode=n;return this;},setHeader(k,v){this.headers[k]=v;},json(body){this.body=body;return this;}});
async function run({body={holdId:ID},auth=true,method='POST'}={}){const res=result();await handler({method,body,headers:auth?{authorization:'Bearer synthetic'}:{}},res);return res;}
before(async()=>{
 mock.method(globalThis,'fetch',async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url);assert.equal(url.origin,'https://extension-cancel.invalid','No live network');
  if(url.pathname==='/auth/v1/user')return Response.json({id:actor,aud:'authenticated'});
  const table=url.pathname.split('/').at(-1);reads.push({table,params:url.searchParams});
  if(dbError===table)return Response.json({code:'XX000',message:'synthetic database error'},{status:500});
  if(table==='release_unpaid_extension_checkout'){
   rpcs.push(JSON.parse(options.body));assert.equal(session.status,'expired');assert.equal(session.payment_status,'unpaid');
   assert.deepEqual(rpcs.at(-1),{p_checkout_session_id:'cs_extension',p_connected_account_id:'acct_host'});
   if(rpcFalse==='kept')return Response.json(false);
   tables.booking_holds=[];tables.pending_booking_extensions=[];
   return Response.json(rpcFalse==='removed'?false:true);
  }
  assert.equal(options.method||'GET','GET','No direct booking/payment/hold writes');
  const rows=tables[table].filter(row=>[...url.searchParams].every(([key,value])=>{
   if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
   if(value.startsWith('in.('))return value.slice(4,-1).split(',').includes(String(row[key]));
   if(value==='not.is.null')return row[key]!=null;
   return true;
  }));
  return Response.json((new Headers(options.headers).get('accept')||'').includes('vnd.pgrst.object')?rows[0]??null:rows);
 });
 lib=await import('../api/_lib.js');
 mock.method(lib.stripe.checkout.sessions,'retrieve',async(id,params,opts)=>{provider.push('retrieve');assert.equal(id,'cs_extension');assert.deepEqual(opts,{stripeAccount:'acct_host'});return {...session};});
 mock.method(lib.stripe.checkout.sessions,'expire',async(id,params,opts)=>{provider.push('expire');assert.equal(id,'cs_extension');assert.deepEqual(opts,{stripeAccount:'acct_host'});if(expireError)throw Error('expiry failed');session.status='expired';afterExpiry?.();return {...session};});
 mock.method(lib.stripe.refunds,'create',()=>assert.fail('No refunds'));
 mock.method(lib.stripe.checkout.sessions,'create',()=>assert.fail('No checkout creation'));
 ({default:handler}=await import('../api/cancel-extension-checkout.js'));
 ({default:accountHandler}=await import('../api/account-bookings.js'));
});
beforeEach(()=>{
 actor=OWNER;provider=[];rpcs=[];reads=[];dbError=null;expireError=false;afterExpiry=null;rpcFalse=null;
 session={id:'cs_extension',mode:'payment',payment_status:'unpaid',status:'open',currency:'cad',amount_total:1725,livemode:false};
 tables={booking_holds:[{id:ID,listing_id:7,renter_id:OWNER,spot_label:'A',starts_at:'2030-01-01T11:00:00Z',ends_at:'2030-01-01T12:00:00Z',stripe_checkout_session_id:'cs_extension',expected_connected_account_id:'acct_host',expected_total_cents:1725}],
  pending_booking_extensions:[{booking_id:42,renter_id:OWNER,added_hours:1,hold_id:ID,stripe_checkout_session_id:'cs_extension',expected_connected_account_id:'acct_host',expected_total_cents:1725}],
  bookings:[{id:42,listing_id:7,renter_id:OWNER,spot_label:'A',stripe_connected_account_id:'acct_host',stripe_checkout_session_id:'cs_original',total:34.5,status:'confirmed',paid_at:'2030-01-01T10:00:00Z',application_state:'applied'}],
  booking_extensions:[{booking_id:42,added_amount:17.25,application_state:'applied',paid_at:'2030-01-01T10:30:00Z',status:'confirmed'}],
  listings:[{id:7,host_id:'host',title:'Synthetic',address:'Synthetic address',price:15,spaces:3}],profiles:[{id:'host',name:'Host'},{id:OWNER,name:'Driver'}],reviews:[]};
});
after(()=>mock.restoreAll());
test('extension cancellation verifies Stripe expiry before atomic release, preserves the paid booking, and is repeatable',async()=>{
 const booking=structuredClone(tables.bookings),ext=structuredClone(tables.booking_extensions);
 const res=await run();assert.equal(res.statusCode,200);assert.equal(res.body.status,'released');assert.deepEqual(provider,['retrieve','expire','retrieve']);assert.equal(rpcs.length,1);
 assert.deepEqual(tables.bookings,booking);assert.deepEqual(tables.booking_extensions,ext);assert.equal(tables.pending_booking_extensions.length,0);
 assert.equal((await run()).body.status,'not_found');assert.equal(rpcs.length,1);assert.equal(res.headers['Cache-Control'],'private, no-store');
});
test('anonymous, wrong-owner, malformed and GET requests cannot touch Stripe or release inventory',async()=>{
 assert.equal((await run({auth:false})).statusCode,401);assert.equal((await run({method:'GET'})).statusCode,405);
 assert.equal((await run({body:{holdId:'bad'}})).statusCode,400);actor='other';assert.equal((await run()).body.status,'not_found');
 assert.equal(provider.length,0);assert.equal(rpcs.length,0);assert.equal(tables.booking_holds.length,1);
});
test('unregistered or changed trusted extension snapshots never reach Stripe',async()=>{
 for(const [table,key,value] of [['pending_booking_extensions','expected_total_cents',1],['booking_holds','stripe_checkout_session_id','cs_other'],['booking_holds','ends_at','2030-01-01T13:00:00Z'],['bookings','stripe_connected_account_id','acct_other'],['bookings','spot_label','B']]){
  const prior=tables[table][0][key];tables[table][0][key]=value;assert.equal((await run()).statusCode,409);tables[table][0][key]=prior;
 }
 tables.pending_booking_extensions=[];assert.equal((await run()).statusCode,409);assert.equal(provider.length,0);assert.equal(rpcs.length,0);
});
test('paid, complete, wrong amount/currency/mode and payment winning expiry preserve the extension hold',async()=>{
 for(const change of [{payment_status:'paid'},{status:'complete'},{currency:'ron'},{amount_total:1},{mode:'subscription'},{livemode:null}]){
  const saved={...session};Object.assign(session,change);assert.equal((await run()).statusCode,409);session=saved;
 }
 expireError=true;assert.equal((await run()).statusCode,503);expireError=false;
 afterExpiry=()=>{session.status='complete';session.payment_status='paid';};assert.equal((await run()).statusCode,409);
 assert.equal(rpcs.length,0);assert.equal(tables.booking_holds.length,1);
});
test('provider mode changes and database failures cannot report a released hold',async()=>{
 afterExpiry=()=>{session.livemode=true;};assert.equal((await run()).statusCode,409);assert.equal(rpcs.length,0);
 session.livemode=false;afterExpiry=null;dbError='release_unpaid_extension_checkout';assert.equal((await run()).statusCode,503);assert.equal(tables.booking_holds.length,1);
 dbError=null;rpcFalse='kept';assert.equal((await run()).statusCode,409);rpcFalse='removed';assert.equal((await run()).body.status,'not_found');
});
test('both account views sum only their authorized booking extensions without returning Stripe identifiers',async()=>{
 tables.bookings.push({...tables.bookings[0],id:99,listing_id:9,renter_id:'unrelated',total:100});
 tables.booking_extensions.push({...tables.booking_extensions[0],booking_id:99,added_amount:999});
 for(const view of ['driver','host']){
  actor=view==='driver'?OWNER:'host';const res=result();await accountHandler({method:'GET',query:{view,userId:'unrelated'},headers:{authorization:'Bearer synthetic'}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.bookings.length,1);assert.equal(res.body.bookings[0].id,42);assert.equal(res.body.bookings[0].total,34.5);assert.equal(res.body.bookings[0].charged_total,51.75);
  assert.equal(res.body.bookings[0].stripe_checkout_session_id,undefined);assert.equal(res.body.bookings[0].booking_extensions,undefined);
  const query=reads.filter(r=>r.table==='booking_extensions').at(-1);assert.equal(query.params.get('booking_id'),'in.(42)');
 }
});
