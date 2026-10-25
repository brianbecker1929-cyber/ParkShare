import assert from 'node:assert/strict';
import {test, before, beforeEach, after, mock} from 'node:test';

const HOST='00000000-0000-4000-8000-000000000001', DRIVER='00000000-0000-4000-8000-000000000002';
Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_synthetic',SUPABASE_URL:'https://written-reviews.invalid',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'});
let handler,publicHandler,actor,booking,requests,reviewFailure;
const privateText='Helpful access instructions <script>alert("test")</script>';
const response=()=>({code:200,headers:{},status(n){this.code=n;return this;},setHeader(k,v){this.headers[k]=v;},json(body){this.body=body;return this;}});
const call=async({auth=true,method='GET',listingId='7',anonymous=false}={})=>{const res=response();await (anonymous?publicHandler:handler)({method,query:{listingId},headers:auth?{authorization:'Bearer synthetic'}:{}},res);return res;};
before(async()=>{
 mock.method(globalThis,'fetch',async(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url);assert.equal(url.origin,'https://written-reviews.invalid');assert.equal(options.method||'GET','GET');requests.push(url);
  if(url.pathname==='/auth/v1/user')return Response.json({id:actor});
  if(url.pathname==='/rest/v1/listings')return Response.json({id:7,host_id:HOST});
  if(url.pathname==='/rest/v1/bookings'){
   assert.equal(url.searchParams.get('renter_id'),'eq.'+actor);assert.equal(url.searchParams.get('listing_id'),'eq.7');assert.equal(url.searchParams.get('status'),'in.(confirmed,completed)');assert.equal(url.searchParams.get('limit'),'1');
   return Response.json(booking?[booking]:[]);
  }
  if(url.pathname==='/rest/v1/reviews'){
   assert.equal(url.searchParams.get('listing_id'),'eq.7');assert.equal(url.searchParams.get('limit'),'100');
   if(reviewFailure)return Response.json({message:'private database error'},{status:500});
   // Return text even if not selected: the final projection must still enforce
   // permission and never leak columns accidentally returned by an upstream.
   return Response.json([{rating:5,created_at:'2026-10-22T10:00:00Z',text:privateText,user_id:DRIVER,profiles:{name:'Private name'}}]);
  }
  assert.fail('Unexpected request '+url.pathname);
 });
 ({default:handler}=await import('../api/listing-reviews.js'));
 ({default:publicHandler}=await import('../api/public-reviews.js'));
});
beforeEach(()=>{actor=DRIVER;booking={listing_id:7,renter_id:DRIVER,status:'completed',paid_at:'2026-10-20T10:00:00Z',stripe_checkout_session_id:'cs_synthetic'};requests=[];reviewFailure=false;});
after(()=>mock.restoreAll());
for(const status of ['confirmed','completed'])test('entitled paid Driver receives persisted written reviews: '+status,async()=>{
 booking.status=status;const res=await call();assert.equal(res.code,200);assert.equal(res.body.textAvailable,true);assert.equal(res.body.reviews[0].text,privateText);assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.headers.Vary,'Authorization');assert.deepEqual(Object.keys(res.body.reviews[0]).sort(),['date','rating','text','user']);
});
test('listing Host sees text without a Driver booking',async()=>{actor=HOST;booking=null;const res=await call();assert.equal(res.body.reviews[0].text,privateText);assert.ok(!requests.some(url=>url.pathname.endsWith('/bookings')));});
for(const condition of ['none','other-driver','other-listing','pending','cancelled','refunded','unpaid','no-checkout'])test('written text remains private for '+condition,async()=>{
 if(condition==='none')booking=null;
 if(condition==='other-driver')booking.renter_id=HOST;
 if(condition==='other-listing')booking.listing_id=8;
 if(['pending','cancelled','refunded'].includes(condition))booking.status=condition;
 if(condition==='unpaid')booking.paid_at=null;
 if(condition==='no-checkout')booking.stripe_checkout_session_id=null;
 const res=await call();assert.equal(res.code,200);assert.equal(res.body.textAvailable,false);assert.equal(res.body.reviews[0].text,'');assert.ok(!requests.find(url=>url.pathname.endsWith('/reviews')).searchParams.get('select').includes('text'));assert.ok(!JSON.stringify(res.body).includes('Private name'));
});
test('anonymous summaries never expose free text or reviewer identities',async()=>{const res=await call({anonymous:true,auth:false});assert.equal(res.code,200);assert.equal(res.body.reviews[0].text,'');assert.ok(!JSON.stringify(res.body).includes('Private name'));});
test('unauthenticated, invalid IDs and wrong methods fail before database reads',async()=>{for(const input of [{auth:false},{listingId:'0'},{method:'POST'}]){const res=await call(input);assert.ok([400,401,405].includes(res.code));assert.equal(requests.length,0);assert.equal(res.headers['Cache-Control'],'private, no-store');}});
test('failed review reads return a retryable error rather than an empty history',async()=>{reviewFailure=true;const res=await call();assert.equal(res.code,503);assert.ok(!JSON.stringify(res.body).includes('private database error'));assert.equal(res.body.reviews,undefined);});
