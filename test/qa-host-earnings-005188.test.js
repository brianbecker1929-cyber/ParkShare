import assert from 'node:assert/strict';
import test from 'node:test';
import {moneyCents,remainingHostAmounts,settledRefundTotals,hostEarningsForRecord,mapHostEarnings} from '../api/_host-earnings.js';
import {hostEarnedTotal,hostTransactionPresentation} from '../src/lib/hostTransactions.js';

const quiet={warn(){}};
function fixture(){
  const f={
    row:{total:115,subtotal:100,service_fee:15,status:'partially_refunded',
      stripe_payment_intent_id:'pi_fixture',stripe_charge_id:'ch_fixture',stripe_connected_account_id:'acct_fixture'},
    charge:{id:'ch_fixture',payment_intent:'pi_fixture',amount:11500,amount_captured:11500,amount_refunded:2300,
      currency:'cad',paid:true,captured:true,status:'succeeded',livemode:false,disputed:false,
      application_fee:'fee_fixture',application_fee_amount:1500},
    fee:{id:'fee_fixture',account:'acct_fixture',charge:'ch_fixture',amount:1500,amount_refunded:300,currency:'cad',livemode:false},
    refunds:[{id:'re_fixture',charge:'ch_fixture',payment_intent:'pi_fixture',amount:2300,status:'succeeded',currency:'cad'}],
    calls:[],pages:null,
  };
  const record=(name,fn)=>async(...args)=>{f.calls.push({name,args});return fn(...args)};
  f.stripe={
    charges:{retrieve:record('charge',()=>structuredClone(f.charge))},
    applicationFees:{retrieve:record('fee',()=>structuredClone(f.fee))},
    paymentIntents:{retrieve:record('intent',()=>({id:'pi_fixture',latest_charge:'ch_fixture'}))},
    refunds:{list:record('refunds',params=> f.pages ? structuredClone(f.pages[params.starting_after?1:0]) : {data:structuredClone(f.refunds),has_more:false})},
  };
  f.resolve=(options={})=>hostEarningsForRecord(f.stripe,f.row,{logger:quiet,...options});
  return f;
}

test('partial refund retains remaining Host earnings with actual fee returned',async()=>{
  const f=fixture(),r=await f.resolve();
  assert.equal(r.net,80);assert.equal(r.platformFee,12);assert.equal(r.refundedAmount,23);
  assert.equal(r.platformFeeRefunded,3);assert.equal(r.earningsState,'verified');
  const transaction={status:'partially_refunded',...r};
  assert.deepEqual(hostTransactionPresentation(transaction),{label:'Partially refunded',isIncome:true});
  assert.equal(hostEarnedTotal([transaction]),80);
  for(const c of f.calls.filter(c=>c.name!=='fee'))assert.equal(c.args.at(-1).stripeAccount,'acct_fixture');
  assert.equal(f.calls.find(c=>c.name==='fee').args.at(-1).stripeAccount,undefined);
});
test('partial refund without application fee return leaves the correct lower amount',async()=>{
  const f=fixture();f.fee.amount_refunded=0;
  assert.equal((await f.resolve()).net,77);
});
test('a verified zero platform fee is distinct from a missing fee record',async()=>{
  const f=fixture();f.row.service_fee=0;f.row.subtotal=115;
  f.charge.application_fee=null;f.charge.application_fee_amount=0;
  assert.equal((await f.resolve()).net,92);
});
test('full refund with returned platform fee contributes zero',async()=>{
  const f=fixture();f.refunds[0].amount=11500;f.charge.amount_refunded=11500;f.fee.amount_refunded=1500;
  const r=await f.resolve();assert.equal(r.net,0);assert.equal(r.earningsStatus,'refunded');
  assert.equal(hostEarnedTotal([r]),0);assert.equal(hostTransactionPresentation(r).isIncome,false);
});
test('retained platform fee after full refund is a negative contribution, not hidden or clamped',async()=>{
  const f=fixture();f.refunds[0].amount=11500;f.charge.amount_refunded=11500;f.fee.amount_refunded=0;
  const r=await f.resolve();assert.equal(r.net,-15);assert.equal(hostEarnedTotal([r]),-15);
  assert.equal(hostEarnedTotal([{status:'confirmed',net:100},r]),85);
});
test('multiple partial refunds use cumulative successful amounts, not the one stored refund field',async()=>{
  const f=fixture();f.row.refund_amount=999;
  f.refunds.push({...f.refunds[0],id:'re_second',amount:1150});f.charge.amount_refunded=3450;f.fee.amount_refunded=450;
  assert.equal((await f.resolve()).net,70);
});
test('duplicate refund observations and repeated reads never deduct twice',async()=>{
  const f=fixture();f.refunds.push({...f.refunds[0]});
  assert.equal((await f.resolve()).net,80);assert.equal((await f.resolve()).net,80);
});
test('pending customer refund is labelled and not deducted as a successful refund',async()=>{
  const f=fixture();f.refunds[0].status='pending';f.fee.amount_refunded=0;
  const r=await f.resolve();assert.equal(r.net,100);assert.equal(r.refundPendingAmount,23);
  assert.equal(r.earningsStatus,'refund_pending');
});
for(const status of ['failed','canceled'])test(`${status} refund does not reduce proceeds`,async()=>{
  const f=fixture();f.refunds[0].status=status;f.charge.amount_refunded=0;f.fee.amount_refunded=0;
  const r=await f.resolve();assert.equal(r.net,100);assert.equal(r.earningsStatus,'confirmed');
});
test('pagination reads every refund page and uses the last returned cursor',async()=>{
  const f=fixture();f.pages=[{data:f.refunds,has_more:true},{data:[{...f.refunds[0],id:'re_second',amount:1150}],has_more:false}];
  f.charge.amount_refunded=3450;f.fee.amount_refunded=450;
  assert.equal((await f.resolve()).net,70);
  assert.equal(f.calls.filter(c=>c.name==='refunds')[1].args[0].starting_after,'re_fixture');
});
test('incomplete or inconsistent pagination produces review, not zero earnings',async()=>{
  const f=fixture();f.pages=[{data:f.refunds,has_more:true},{data:f.refunds,has_more:true}];
  const r=await f.resolve();assert.equal(r.net,null);assert.equal(r.earningsState,'needs_review');
});
test('legacy missing charge ID resolves through its original connected PaymentIntent',async()=>{
  const f=fixture();f.row.stripe_charge_id=null;
  assert.equal((await f.resolve()).net,80);assert.equal(f.calls[0].name,'intent');
});
test('unrefunded stored payment does not depend on a live Stripe call',async()=>{
  const f=fixture();f.row.status='confirmed';
  const r=await f.resolve();assert.equal(r.net,100);assert.equal(f.calls.length,0);
});
test('extension refund uses actual charge fee instead of its historical estimate',async()=>{
  const f=fixture();f.row.added_amount=115;f.fee.amount=1499;f.charge.application_fee_amount=1499;
  const r=await f.resolve({isExtension:true});assert.equal(r.net,80.01);assert.equal(r.approximateFeeSplit,false);
});
test('unrefunded legacy extension uses its actual fee without a percentage estimate',async()=>{
  const f=fixture();f.row.status='confirmed';f.row.added_amount=115;
  f.refunds=[];f.charge.amount_refunded=0;f.fee.amount_refunded=0;
  f.fee.amount=1499;f.charge.application_fee_amount=1499;
  const r=await f.resolve({isExtension:true});assert.equal(r.net,100.01);assert.equal(r.approximateFeeSplit,false);
});
const mismatches=[
  ['wrong payment intent',f=>f.charge.payment_intent='pi_other'],
  ['wrong charge amount',f=>f.charge.amount=1],
  ['uncaptured charge',f=>f.charge.captured=false],
  ['wrong currency',f=>f.charge.currency='usd'],
  ['wrong fee account',f=>f.fee.account='acct_other'],
  ['wrong fee charge',f=>f.fee.charge='ch_other'],
  ['wrong fee mode',f=>f.fee.livemode=true],
  ['wrong fee amount',f=>f.fee.amount=1],
  ['missing application fee',f=>f.charge.application_fee=null],
  ['excess fee refund',f=>f.fee.amount_refunded=1501],
  ['wrong refund charge',f=>f.refunds[0].charge='ch_other'],
  ['unknown refund state',f=>f.refunds[0].status='unknown'],
  ['missing refund from reported cumulative amount',f=>f.refunds=[]],
  ['conflicting repeated refund state',f=>f.refunds.push({...f.refunds[0],status:'pending'})],
  ['missing connected account',f=>f.row.stripe_connected_account_id=null],
  ['invalid stored split',f=>f.row.subtotal=null],
  ['disputed charge',f=>f.charge.disputed=true],
  ['disputed extension',f=>f.row.charge_disputed=true],
];
for(const [name,change]of mismatches)test(`${name} keeps the transaction under review`,async()=>{
  const f=fixture();change(f);const r=await f.resolve();
  assert.equal(r.earningsState,'needs_review');assert.equal(r.net,null);assert.equal(hostEarnedTotal([r]),0);
  assert.equal(hostTransactionPresentation(r).isIncome,false);
});
test('Stripe read failure keeps a visible review state and excludes unknown amounts',async()=>{
  const f=fixture();f.stripe.charges.retrieve=async()=>{throw new Error('unavailable')};
  const r=await f.resolve();assert.equal(r.net,null);assert.equal(hostTransactionPresentation(r).label,'Earnings under review');
});
test('expired request budget keeps the row under review without starting another provider read',async()=>{
  const f=fixture();const r=await f.resolve({deadlineAt:Date.now()-1});
  assert.equal(r.net,null);assert.equal(r.earningsState,'needs_review');assert.equal(f.calls.length,0);
});
test('integer-cent totals preserve cents and do not introduce rounding drift',()=>{
  assert.equal(hostEarnedTotal([{status:'confirmed',net:0.1},{status:'completed',net:0.2}]),0.3);
  assert.equal(moneyCents('27.6000'),2760);
  for(const value of [null,undefined,'',true,[],{},NaN,-1,1.001])assert.throws(()=>moneyCents(value));
  assert.throws(()=>remainingHostAmounts({gross:100,fee:1,refunded:101,feeRefunded:0}));
});
test('bounded reconciliation preserves row order without unbounded Stripe concurrency',async()=>{
  let active=0,max=0;
  const r=await mapHostEarnings([1,2,3,4,5,6],async value=>{
    active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return value*2;
  },2);
  assert.deepEqual(r,[2,4,6,8,10,12]);assert.equal(max,2);
});
