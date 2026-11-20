import test from 'node:test';
import assert from 'node:assert/strict';
import {processBookingRefund,drainBookingRefunds} from '../api/_refund-operations.js';
const NOW=new Date('2026-11-11T12:00:00Z');
function harness(change={},notify){
 let op={id:'operation-fixture',booking_id:1,livemode:false,connected_account_id:'acct_fixture',payment_intent_id:'pi_fixture',charge_id:'ch_fixture',currency:'cad',amount_cents:2500,gross_cents:10000,processing_fee_cents:320,fee_payer:'parkshare',reason_code:'staff_goodwill',state:'queued',refund_attempt_at:NOW.toISOString(),...change};
 let held=false,ledger=true,networkLost=false,providerLost=false;
 const refunds=[],transfers=[],chargeReads=[],refundReads=[],providerTransfers=new Map();
 const charge={object:'charge',id:'ch_fixture',payment_intent:'pi_fixture',currency:'cad',amount:10000,livemode:false,paid:true,captured:true,status:'succeeded',disputed:false};
 const refund={object:'refund',id:'re_fixture',payment_intent:'pi_fixture',charge:'ch_fixture',currency:'cad',amount:2500,status:'succeeded'};
 const db={async rpc(name,args){
  if(name==='claim_booking_refund'){if(held||op.state!=='queued')return {data:null};held=true;return {data:{...op}};}
  if(name==='allocate_refund_fee_credit'){op.fee_credit_cents??=op.fee_payer==='host'?0:80;return {data:{...op}};}
  throw Error(name);
 },from(table){let values;const q={select(){return q;},update(v){values=v;return q;},eq(){return q;},maybeSingle(){return Promise.resolve({data:ledger?{status:'succeeded',amount_cents:2500,booking_id:1}:null});},then(resolve){if(values)Object.assign(op,values);return Promise.resolve({}).then(resolve);}};return q;}};
 const stripe={charges:{async retrieve(id,params,options){chargeReads.push({id,params,options});return {...charge};}},refunds:{async create(params,options){refunds.push({params,options});if(providerLost){providerLost=false;throw Error('network lost');}return {...refund};},async retrieve(id,params,options){refundReads.push({id,params,options});return {...refund};}},transfers:{async create(params,options){transfers.push({params,options});if(!providerTransfers.has(options.idempotencyKey))providerTransfers.set(options.idempotencyKey,{id:'tr_fixture',...params,livemode:false,reversed:false});if(networkLost){networkLost=false;throw Error('accepted but response lost');}return providerTransfers.get(options.idempotencyKey);}}};
 return {run:(now=NOW)=>processBookingRefund({db,stripe,id:op.id,livemode:false,now,notify}),release:()=>{held=false;},op,stripe,charge,chargeReads,refund,refunds,refundReads,transfers,providerTransfers,setLedger:v=>{ledger=v;},loseTransferResponse:()=>{networkLost=true;},loseRefundResponse:()=>{providerLost=true;}};
}
test('review hold survives an unsuccessful emergency notification and cannot initiate a Host transfer',async()=>{
 const alerts=[];const h=harness({},async(kind,context)=>{alerts.push({kind,context});return {status:'delivery_failed'};});
 h.refund.status='failed';assert.equal(await h.run(),'review');assert.equal(h.op.state,'review');
 assert.equal(h.op.review_code,'customer_refund_failed');assert.equal(h.transfers.length,0);
 assert.deepEqual(alerts,[{kind:'refund_needs_review',context:{operationId:'operation-fixture',bookingId:1,connectedAccountId:'acct_fixture',livemode:false}}]);
 h.release();assert.equal(await h.run(),'busy');assert.equal(alerts.length,1);
});
test('ambiguous financial result remains pending after an emergency alert, with the same provider retry key',async()=>{
 const alerts=[];const h=harness({},async(kind,context)=>{alerts.push({kind,context});return {status:'accepted'};});
 h.loseRefundResponse();assert.equal(await h.run(),'pending');assert.equal(h.op.state,'queued');
 assert.equal(alerts[0].kind,'refund_retry_required');h.release();assert.equal(await h.run(),'complete');
 assert.equal(h.refunds.length,2);assert.deepEqual(h.refunds[0],h.refunds[1]);
});
test('full path persists the actual refund and separate fee transfer; only one worker obtains the lease',async()=>{
 const h=harness();assert.equal(Object.hasOwn(h.refund,'livemode'),false);assert.deepEqual((await Promise.all([h.run(),h.run()])).sort(),['busy','complete']);
 assert.equal(h.refunds.length,1);assert.equal(h.transfers.length,1);assert.equal(h.op.state,'complete');
 assert.equal(h.refunds[0].options.stripeAccount,'acct_fixture');assert.equal(h.refunds[0].params.refund_application_fee,true);
 assert.equal(h.chargeReads[0].id,'ch_fixture');assert.equal(h.chargeReads[0].options.stripeAccount,'acct_fixture');
 assert.equal(h.transfers[0].params.destination,'acct_fixture');assert.equal(h.transfers[0].options.stripeAccount,undefined);
 assert.equal(h.op.transfer_id,'tr_fixture');h.release();assert.equal(await h.run(),'busy');
});
test('no fee transfer occurs before the verified refund ledger agrees',async()=>{
 const h=harness();h.setLedger(false);assert.equal(await h.run(),'pending');assert.equal(h.transfers.length,0);assert.equal(h.op.refund_id,'re_fixture');
 h.release();h.setLedger(true);assert.equal(await h.run(),'complete');assert.equal(h.refunds.length,1);assert.equal(h.transfers.length,1);
});
test('Host-funded refund creates no platform transfer',async()=>{
 const h=harness({fee_payer:'host'});assert.equal(await h.run(),'complete');assert.equal(h.op.fee_credit_cents,0);assert.equal(h.transfers.length,0);
});
test('failed customer refunds cannot reimburse a Host',async()=>{
 const h=harness();h.refund.status='failed';assert.equal(await h.run(),'review');assert.equal(h.transfers.length,0);assert.equal(h.op.review_code,'customer_refund_failed');
});
test('a lost transfer response reuses the frozen key and amount, creating one provider transfer',async()=>{
 const h=harness();h.loseTransferResponse();assert.equal(await h.run(),'pending');assert.equal(h.op.transfer_id,undefined);h.release();assert.equal(await h.run(),'complete');
 assert.equal(h.transfers.length,2);assert.equal(h.providerTransfers.size,1);assert.deepEqual(h.transfers[0],h.transfers[1]);
});
test('an ambiguous refund retries with the same key inside 24 hours and blocks after expiry',async()=>{
 const h=harness();h.loseRefundResponse();assert.equal(await h.run(),'pending');h.release();
 assert.equal(await h.run(new Date(+NOW+86400000)),'review');assert.equal(h.refunds.length,1);assert.equal(h.op.review_code,'refund_idempotency_window_expired');
});
test('an ambiguous transfer never retries after the provider idempotency window',async()=>{
 const h=harness();h.loseTransferResponse();assert.equal(await h.run(),'pending');h.release();assert.equal(await h.run(new Date(+NOW+86400000)),'review');assert.equal(h.transfers.length,1);
});
test('mode and refund identity mismatches stop before any reimbursement',async()=>{
 const mode=harness({livemode:true});assert.equal(await mode.run(),'review');assert.equal(mode.refunds.length,0);
 const identity=harness();identity.refund.charge='ch_unrelated';assert.equal(await identity.run(),'review');assert.equal(identity.transfers.length,0);
});
test('canonical charge validation rejects mismatches before creating a refund',async t=>{
 for(const [name,change] of Object.entries({
  object:{object:'payment_intent'},id:{id:'ch_unrelated'},intent:{payment_intent:'pi_unrelated'},
  mode:{livemode:true},missingMode:{livemode:undefined},currency:{currency:'usd'},amount:{amount:9999},
  unpaid:{paid:false},uncaptured:{captured:false},failed:{status:'failed'},disputed:{disputed:true},
 })) await t.test(name,async()=>{
  const h=harness();Object.assign(h.charge,change);
  assert.equal(await h.run(),'review');assert.equal(h.op.review_code,'refund_payment_identity_mismatch');
  assert.equal(h.refunds.length,0);assert.equal(h.transfers.length,0);
 });
});
test('a charge lookup failure stays pending without making financial writes',async()=>{
 const h=harness(),retrieve=h.stripe.charges.retrieve;
 h.stripe.charges.retrieve=async()=>{throw Error('connection interrupted');};
 assert.equal(await h.run(),'pending');assert.equal(h.refunds.length,0);assert.equal(h.transfers.length,0);
 h.release();h.stripe.charges.retrieve=retrieve;assert.equal(await h.run(),'complete');
 assert.equal(h.refunds.length,1);assert.equal(h.transfers.length,1);
});
test('expanded Stripe payment references are validated by their IDs',async()=>{
 const h=harness();h.charge.payment_intent={id:'pi_fixture',object:'payment_intent'};
 h.refund.payment_intent={id:'pi_fixture',object:'payment_intent'};h.refund.charge={...h.charge};
 assert.equal(await h.run(),'complete');assert.equal(h.transfers.length,1);
});
test('refund contract mismatches cannot create a reimbursement',async t=>{
 for(const [name,change] of Object.entries({
  object:{object:'charge'},id:{id:'ch_wrong'},missingId:{id:undefined},
  intent:{payment_intent:{id:'pi_unrelated'}},charge:{charge:{id:'ch_unrelated'}},
  currency:{currency:'usd'},amount:{amount:2499},
 })) await t.test(name,async()=>{
  const h=harness();Object.assign(h.refund,change);assert.equal(await h.run(),'review');
  assert.equal(h.op.review_code,'refund_identity_mismatch');assert.equal(h.transfers.length,0);
 });
});
test('a saved refund is retrieved in its account without recreating it',async()=>{
 const h=harness({refund_id:'re_fixture',refund_attempt_at:'2026-11-01T12:00:00Z'});
 assert.equal(await h.run(),'complete');assert.equal(h.refunds.length,0);
 assert.deepEqual(h.refundReads,[{id:'re_fixture',params:{},options:{stripeAccount:'acct_fixture',timeout:8000,maxNetworkRetries:0}}]);
 const mismatch=harness({refund_id:'re_different'});assert.equal(await mismatch.run(),'review');
 assert.equal(mismatch.refunds.length,0);assert.equal(mismatch.transfers.length,0);
});
test('a pending customer refund is recorded and must succeed before fee credit',async()=>{
 const h=harness();h.refund.status='pending';assert.equal(await h.run(),'pending');
 assert.equal(h.op.refund_id,'re_fixture');assert.equal(h.op.fee_credit_cents,undefined);assert.equal(h.transfers.length,0);
 h.release();h.refund.status='succeeded';assert.equal(await h.run(),'complete');
 assert.equal(h.refunds.length,1);assert.equal(h.refundReads.length,1);assert.equal(h.transfers.length,1);
});
test('an interrupted refund creation retries with the same provider key and amount',async()=>{
 const h=harness();h.loseRefundResponse();assert.equal(await h.run(),'pending');h.release();
 assert.equal(await h.run(new Date(+NOW+10000)),'complete');assert.deepEqual(h.refunds[0],h.refunds[1]);
 assert.equal(h.transfers.length,1);
});
test('existing review operations are not automatically reclaimed or retried',async()=>{
 const h=harness({state:'review',review_code:'refund_identity_mismatch'});
 assert.equal(await h.run(),'busy');assert.equal(h.chargeReads.length,0);assert.equal(h.refunds.length,0);assert.equal(h.transfers.length,0);
 const filters=[];
 const db={from(table){assert.equal(table,'booking_refund_operations');const q={
  select(){return q;},eq(k,v){filters.push([k,v]);return q;},lte(){return q;},order(){return q;},
  async limit(){return {data:[]};},
 };return q;}};
 assert.deepEqual(await drainBookingRefunds({db,stripe:h.stripe,livemode:false}),{complete:0,pending:0,busy:0,review:0});
 assert.deepEqual(filters,[['livemode',false],['state','queued']]);
});
