import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import Stripe from 'stripe';
import {CheckoutIntegrityError} from '../api/_checkout-integrity.js';
import {retryTransientSupabaseRead,isTransientSupabaseError} from '../api/_webhook-db-retry.js';

const source=await readFile(new URL('../api/stripe-webhook.js',import.meta.url),'utf8');
const poolError={code:'PGRST003',message:'Timed out acquiring connection from connection pool.'};
const noDelay=async()=>{};
const secret='whsec_local_synthetic';
const signedStripe=new Stripe('sk_test_local_synthetic');

function fixture({failures=1,failTable='bookings',error=poolError}={}){
 const reads=[],confirmations=[],logs=[];
 let existing=null,failuresLeft=failures;
 const session={id:'cs_test_local_fixture',payment_status:'paid',livemode:false};
 const event={id:'evt_local_fixture',type:'checkout.session.completed',account:'acct_local_fixture',livemode:false,data:{object:session}};
 const hold={id:'hold_local',listing_id:7,expected_connected_account_id:event.account};
 const db={from(table){return {
  select(){return this;},eq(){return this;},async maybeSingle(){
   reads.push(table);
   if(table===failTable&&failuresLeft>0){failuresLeft--;return {data:null,error};}
   return {data:table==='bookings'?existing:table==='booking_holds'?hold:null,error:null};
  },
 };}};
 const dependencies={
  reportPaymentAlert:async()=>({status:'disabled'}),
  supabaseAdmin:db,
  CheckoutIntegrityError,
  retryTransientSupabaseRead:(read,options)=>retryTransientSupabaseRead(read,{...options,pause:noDelay}),
  confirmBooking:async(current)=>{confirmations.push(current.id);existing={id:42,application_state:'applied'};},
  refundInvalidRegisteredCheckout:()=>assert.fail('A database fault must not initiate a refund'),
  console:{warn:(...args)=>logs.push(args),info:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},
 };
 const readCode=source.slice(source.indexOf('function readCheckoutDb('),source.indexOf('async function validatedIntent'));
 const paidCode=source.slice(source.indexOf('async function processPaidCheckout('),source.indexOf('// A signed expired/async-failed'));
 const {processPaidCheckout}=new Function(...Object.keys(dependencies),readCode+paidCode+';return {processPaidCheckout};')(...Object.values(dependencies));
 const rawCode=source.slice(source.indexOf('function readRawBody('),source.indexOf('// "Today"'));
 const readRawBody=new Function(rawCode+';return readRawBody;')();
 const handlerCode=source.slice(source.indexOf('export default async function handler')).replace('export default async function handler','return async function handler');
 const handlerDependencies={...dependencies,readRawBody,processPaidCheckout,stripe:signedStripe,paidCheckoutReferenceLog:()=>null,process:{env:{STRIPE_WEBHOOK_SECRET:secret}}};
 const handler=new Function(...Object.keys(handlerDependencies),handlerCode)(...Object.values(handlerDependencies));
 return {reads,confirmations,logs,async deliver(valid=true){
  const payload=JSON.stringify(event),request=Readable.from([Buffer.from(payload)]);
  request.method='POST';request.headers={'stripe-signature':valid?signedStripe.webhooks.generateTestHeaderString({payload,secret}):'invalid'};
  const response={status(n){this.code=n;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};
  await handler(request,response);return response;
 }};
}

for(const failTable of ['bookings','booking_holds']){
 test(`one pool timeout in ${failTable} recovers within the first signed delivery; replay never duplicates confirmation`,async()=>{
  const f=fixture({failTable});
  assert.equal((await f.deliver()).code,200);
  assert.equal(f.reads.filter(table=>table===failTable).length,2);
  assert.deepEqual(f.confirmations,['cs_test_local_fixture']);
  assert.equal((await f.deliver()).code,200);
  assert.deepEqual(f.confirmations,['cs_test_local_fixture']);
 });
}
test('persistent pool exhaustion makes exactly two read attempts and returns 500 without confirming or refunding',async()=>{
 const f=fixture({failures:Infinity});
 const response=await f.deliver();
 assert.equal(response.code,500);
 assert.deepEqual(response.body,{error:'Webhook processing failed'});
 assert.deepEqual(f.reads,['bookings','bookings']);
 assert.deepEqual(f.confirmations,[]);
});
test('a stale financial snapshot is not reclassified as a database connection failure',async()=>{
 for(const code of ['PT409','40001','23503','42501','57014']){
  const error={code,message:'Refund snapshot changed concurrently; retrieve and retry'};
  assert.equal(isTransientSupabaseError(error),false);
  const f=fixture({error,failures:Infinity});
  assert.equal((await f.deliver()).code,500);
  assert.deepEqual(f.reads,['bookings']);
  assert.deepEqual(f.confirmations,[]);
 }
});
test('invalid Stripe signatures cannot reach the retry or settlement paths',async()=>{
 const f=fixture();assert.equal((await f.deliver(false)).code,400);
 assert.deepEqual(f.reads,[]);assert.deepEqual(f.confirmations,[]);
});
