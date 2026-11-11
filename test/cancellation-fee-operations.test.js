import test from 'node:test';
import assert from 'node:assert/strict';
import {processBookingRefund} from '../api/_refund-operations.js';
const NOW=new Date('2026-11-11T12:00:00Z');
function harness(change={}){
 let op={id:'operation-fixture',booking_id:1,livemode:false,connected_account_id:'acct_fixture',payment_intent_id:'pi_fixture',charge_id:'ch_fixture',currency:'cad',amount_cents:2500,gross_cents:10000,processing_fee_cents:320,fee_payer:'parkshare',reason_code:'staff_goodwill',state:'queued',refund_attempt_at:NOW.toISOString(),...change};
 let held=false,ledger=true,networkLost=false,providerLost=false;
 const refunds=[],transfers=[],providerTransfers=new Map();
 const refund={id:'re_fixture',payment_intent:'pi_fixture',charge:'ch_fixture',currency:'cad',amount:2500,livemode:false,status:'succeeded'};
 const db={async rpc(name,args){
  if(name==='claim_booking_refund'){if(held||op.state!=='queued')return {data:null};held=true;return {data:{...op}};}
  if(name==='allocate_refund_fee_credit'){op.fee_credit_cents??=op.fee_payer==='host'?0:80;return {data:{...op}};}
  throw Error(name);
 },from(table){let values;const q={select(){return q;},update(v){values=v;return q;},eq(){return q;},maybeSingle(){return Promise.resolve({data:ledger?{status:'succeeded',amount_cents:2500,booking_id:1}:null});},then(resolve){if(values)Object.assign(op,values);return Promise.resolve({}).then(resolve);}};return q;}};
 const stripe={refunds:{async create(params,options){refunds.push({params,options});if(providerLost){providerLost=false;throw Error('network lost');}return {...refund};},async retrieve(){return {...refund};}},transfers:{async create(params,options){transfers.push({params,options});if(!providerTransfers.has(options.idempotencyKey))providerTransfers.set(options.idempotencyKey,{id:'tr_fixture',...params,livemode:false,reversed:false});if(networkLost){networkLost=false;throw Error('accepted but response lost');}return providerTransfers.get(options.idempotencyKey);}}};
 return {run:(now=NOW)=>processBookingRefund({db,stripe,id:op.id,livemode:false,now}),release:()=>{held=false;},op,refund,refunds,transfers,providerTransfers,setLedger:v=>{ledger=v;},loseTransferResponse:()=>{networkLost=true;},loseRefundResponse:()=>{providerLost=true;}};
}
test('full path persists the actual refund and separate fee transfer; only one worker obtains the lease',async()=>{
 const h=harness();assert.deepEqual((await Promise.all([h.run(),h.run()])).sort(),['busy','complete']);
 assert.equal(h.refunds.length,1);assert.equal(h.transfers.length,1);assert.equal(h.op.state,'complete');
 assert.equal(h.refunds[0].options.stripeAccount,'acct_fixture');assert.equal(h.refunds[0].params.refund_application_fee,true);
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
