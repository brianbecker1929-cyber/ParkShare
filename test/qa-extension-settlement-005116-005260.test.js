import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {readExtensionPayment,rejectExtensionPayment,recoverRejectedExtensionRefund} from '../api/_extension-payment.js';
import {CheckoutIntegrityError,verifyPaidCheckout} from '../api/_checkout-integrity.js';
import {requirePaidCheckoutReference} from '../api/_paid-checkout-reference.js';
import {isExpectedCheckoutTermination,matchesRegisteredCheckoutAccount,canFailUnpaidBooking} from '../api/_checkout-terminal-safety.js';
const source=await readFile(process.env.QA_EXTENSION_WEBHOOK_SOURCE||new URL('../api/stripe-webhook.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const code=section('async function confirmExtension(', 'async function sendExtensionConfirmedEmail(')
 +section('async function processPaidCheckout(', '// A signed expired/async-failed')
 +section('async function processCheckoutTermination(', 'export default async function handler');
const session=()=>({id:'cs_extension',mode:'payment',currency:'cad',amount_total:115,payment_status:'paid',payment_intent:'pi_extension',livemode:false,created:1792000000});
const charge=()=>({id:'ch_extension',payment_intent:'pi_extension',currency:'cad',amount:115,amount_captured:115,amount_refunded:0,paid:true,captured:true,status:'succeeded',livemode:false});
const refund=(status='succeeded',amount=115)=>({id:'re_extension',payment_intent:'pi_extension',charge:'ch_extension',currency:'cad',amount,status,created:1792000000,metadata:{parkshare_reason:'invalid_registered_checkout',checkout_session_id:'cs_extension'}});
function harness({history=[],lookupError=null,rpcError=null,existing=null,parentStatus='confirmed'}={}){
 const calls=[],pending={id:9,booking_id:7,renter_id:'driver',added_hours:1,expected_total_cents:115,expected_service_fee_cents:15,expected_connected_account_id:'acct_owner',stripe_checkout_session_id:'cs_extension',hold_id:'hold_own'};
 const state={hours:1,hold:{id:'hold_own',expected_connected_account_id:null},pending,extension:existing,history:structuredClone(history)};
 const s=session(),c={...charge(),amount_refunded:history.filter(r=>['succeeded','pending'].includes(r.status)).reduce((n,r)=>n+r.amount,0)};
 const event={id:'evt_checkout',created:1792000000,type:'checkout.session.completed',account:'acct_owner',livemode:false,data:{object:s}};
 const intent=()=>({id:'pi_extension',latest_charge:'ch_extension',currency:'cad',amount_received:115,application_fee_amount:15,status:'succeeded',livemode:false});
 const stripe={paymentIntents:{retrieve:async(id,p,o)=>{calls.push(['intent',id,o]);return intent();}},charges:{retrieve:async(id,p,o)=>{calls.push(['charge',id,o]);return {...c};}},
  refunds:{list:async(p,o)=>{calls.push(['list',p,o]);return {data:state.history,has_more:false};},retrieve:async()=>state.history[0],create:async(p,o)=>{calls.push(['refund',p,o]);state.history=[refund()];c.amount_refunded=115;return state.history[0];}},
  checkout:{sessions:{retrieve:async()=>s}}};
 const db={from(table){const filters=[];const q={select(){return this;},eq(k,v){filters.push([k,v]);return this;},maybeSingle:async()=>get(),single:async()=>get()};
   function get(){calls.push(['read',table,filters]);if(lookupError)return {error:lookupError};
    if(table==='pending_booking_extensions')return {data:state.pending};
    if(table==='booking_extensions')return {data:state.extension};
    if(table==='booking_holds')return {data:state.hold};
    if(table==='bookings')return {data:filters.some(([k])=>k==='stripe_checkout_session_id')?null:{id:7,listing_id:3,renter_id:'driver',hours:state.hours,status:parentStatus,stripe_connected_account_id:'acct_owner'}};
    throw new Error(table);
   }return q;},
  async rpc(name,p){calls.push(['rpc',name,p]);if(rpcError)return {error:rpcError};
   if(name==='apply_paid_booking_extension'){
    if(state.extension)return {data:[{applied:false,resulting_hours:state.hours}]};
    state.hours+=1;state.hold=null;state.extension={id:21,application_state:'applied'};return {data:[{applied:true,resulting_hours:state.hours}]};
   }
   if(name==='record_rejected_booking_extension'){
    if(state.extension?.application_state==='applied')return {error:{code:'22023'}};
    state.extension={id:21,application_state:'rejected'};state.hold=null;return {data:21};
   }
   if(name==='release_unpaid_extension_checkout'){state.hold=null;state.pending=null;return {data:true};}
   throw new Error(name);
  }};
 const reconcile=async()=>{calls.push(['ledger']);state.refundTotal=state.history.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amount,0);};
 const validatedIntent=async(s,account,expected,host,total,fee)=>verifyPaidCheckout({session:s,eventAccount:account,expectedSessionId:pending.stripe_checkout_session_id,expectedConnectedAccountId:expected,actualHostAccountId:host,expectedTotalCents:total,expectedApplicationFeeCents:fee,paymentIntent:intent()});
 const deps={supabaseAdmin:db,stripe,readCheckoutDb:f=>f(),CheckoutIntegrityError,requirePaidCheckoutReference,
   hostAccountForListing:async()=>({connectedAccountId:'acct_owner'}),validatedIntent,readExtensionPayment,rejectExtensionPayment,reconcilePaymentRefund:reconcile,
   confirmBooking:()=>assert.fail('Extension hold entered new-booking path'),refundInvalidRegisteredCheckout:()=>assert.fail('Extension entered base refund path'),
   sendExtensionConfirmedEmail:async()=>calls.push(['email']),isExpectedCheckoutTermination,matchesRegisteredCheckoutAccount,canFailUnpaidBooking};
 const functions=new Function(...Object.keys(deps),code+';return {processPaidCheckout,processCheckoutTermination};')(...Object.values(deps));
 return {state,calls,pending,stripe,db,event,s,c,run:()=>functions.processPaidCheckout(s,event.account,event),terminate:()=>functions.processCheckoutTermination(event),reconcile};
}
test('real paid dispatcher plus extension handler accepts BOTH registered rows, adds one hour, releases hold, and replays exactly once',async()=>{
 const h=harness();await h.run();await h.run();assert.equal(h.state.hours,2);assert.equal(h.state.hold,null);
 assert.equal(h.calls.filter(c=>c[0]==='rpc'&&c[1]==='apply_paid_booking_extension').length,1);
 assert.equal(h.calls.filter(c=>c[0]==='refund').length,0);assert.equal(h.calls.filter(c=>c[0]==='email').length,1);
});
for(const status of ['succeeded','pending','requires_action'])test(`already ${status} refund cannot grant time or create another refund; records rejected audit and releases own hold`,async()=>{
 const h=harness({history:[refund(status)]});if(status==='requires_action')h.c.amount_refunded=115;
 await h.run();await h.run();assert.equal(h.state.hours,1);assert.equal(h.state.hold,null);assert.equal(h.state.extension.application_state,'rejected');
 assert.equal(h.calls.some(c=>c[0]==='refund'),false);assert.equal(h.calls.some(c=>c[0]==='email'),false);assert.ok(h.calls.some(c=>c[0]==='ledger'));
});
test('integrity rejection durably journals before refund, releases hold, and replays without duplicate money movement',async()=>{
 const h=harness();h.pending.expected_total_cents=999;await h.run();await h.run();
 assert.equal(h.state.hours,1);assert.equal(h.state.refundTotal,115);assert.equal(h.state.extension.application_state,'rejected');
 assert.equal(h.calls.filter(c=>c[0]==='refund').length,1);
 assert.ok(h.calls.findIndex(c=>c[1]==='record_rejected_booking_extension')<h.calls.findIndex(c=>c[0]==='refund'));
});
test('database failures and wrong accounts never create refunds or grant time',async()=>{
 for(const opts of [{lookupError:{code:'42501'}},{history:[refund()],rpcError:{code:'40001'}}]){
  const h=harness(opts);await assert.rejects(h.run());assert.equal(h.state.hours,1);assert.equal(h.calls.some(c=>c[0]==='refund'),false);
 }
 const h=harness();h.event.account='acct_foreign';await assert.rejects(h.run());assert.equal(h.calls.some(c=>c[0]==='refund'),false);
});
test('failed refund creation leaves a durable rejected marker; replay resumes refund and ledger, never application',async()=>{
 const h=harness();h.pending.expected_total_cents=999;const original=h.stripe.refunds.create;h.stripe.refunds.create=async()=>{throw new Error('provider unavailable')};
 await assert.rejects(h.run());assert.equal(h.state.extension.application_state,'rejected');assert.equal(h.state.hold,null);
 h.stripe.refunds.create=original;await h.run();assert.equal(h.state.hours,1);assert.equal(h.state.refundTotal,115);
});
test('unpaid terminal extension deliberately has hold and pending pair; cleanup is delegated atomically',async()=>{
 const h=harness();Object.assign(h.s,{payment_status:'unpaid',status:'expired'});h.event.type='checkout.session.expired';await h.terminate();
 assert.equal(h.state.hold,null);assert.equal(h.state.pending,null);assert.equal(h.state.hours,1);assert.ok(h.calls.some(c=>c[1]==='release_unpaid_extension_checkout'));
});
test('terminal mismatch and stale paid event preserve extension registration',async()=>{
 const h=harness();h.event.type='checkout.session.expired';h.s.status='expired';await h.terminate();assert.ok(h.state.pending);assert.ok(h.state.hold);
 const foreign=harness();Object.assign(foreign.s,{payment_status:'unpaid',status:'expired'});foreign.event.type='checkout.session.expired';foreign.state.hold.id='another';
 await assert.rejects(foreign.terminate());assert.ok(foreign.state.pending);
});
test('historical integrity-refund replay repairs missing audit without granting time or issuing refunds',async()=>{
 const h=harness({history:[refund()]});const event={...h.event,type:'refund.updated',data:{object:refund()}};
 await recoverRejectedExtensionRefund({event,stripe:h.stripe,db:h.db});
 assert.equal(h.state.extension.application_state,'rejected');assert.equal(h.state.hours,1);assert.equal(h.state.hold,null);assert.equal(h.calls.some(c=>c[0]==='refund'),false);
});
test('historical recovery ignores foreign account and already-applied payments',async()=>{
 for(const existing of [null,{id:21,application_state:'applied'}]){
  const h=harness({history:[refund()],existing});const event={...h.event,type:'refund.updated',account:existing?'acct_owner':'acct_foreign',data:{object:refund()}};
  await recoverRejectedExtensionRefund({event,stripe:h.stripe,db:h.db});assert.ok(h.state.hold);assert.equal(h.calls.some(c=>c[0]==='rpc'),false);
 }
});
test('ambiguous provider data, mode changes, missing history and disputes never grant parking time',async()=>{
 for(const change of [h=>h.c.livemode=true,h=>h.c.amount_refunded=115,h=>h.stripe.refunds.list=async()=>({data:[],has_more:true})]){
  const h=harness();change(h);await assert.rejects(h.run());assert.equal(h.state.hours,1);assert.equal(h.calls.some(c=>c[0]==='rpc'),false);
 }
 const h=harness();h.c.disputed=true;await h.run();assert.equal(h.state.hours,1);assert.equal(h.calls.some(c=>c[0]==='refund'),false);
});

const transactionSource=await readFile(new URL('../api/transactions.js',import.meta.url),'utf8');
function spentHistory({refundTotal=1.15,refundPending=0}={}){
 const ext={id:21,booking_id:7,added_hours:1,added_amount:1.15,application_state:'rejected',status:'payment_failed',paid_at:'2026-10-20T12:00Z',refund_total_amount:refundTotal,refund_pending_amount:refundPending};
 const calls=[];
 const db={from(table){let fields;const q={select(value){fields=value;return this;},eq(k,v){calls.push([table,k,v]);return this;},not(){return this;},order(){return Promise.resolve({data:[{id:7,listing_id:3,renter_id:'driver',hours:1,total:10,status:'confirmed',paid_at:'2026-10-20T11:00Z'}]});},in(k,ids){calls.push([table,k,ids]);return this;},then(resolve){return Promise.resolve({data:[Object.fromEntries(fields.split(',').map(k=>[k.trim(),ext[k.trim()]]))]}).then(resolve);}};return q;}};
 const code=transactionSource.slice(transactionSource.indexOf('function spendingRefundAmounts'),transactionSource.indexOf('// Money the user has EARNED'))
  +transactionSource.slice(transactionSource.indexOf('async function fetchExtensionsForBookings'),transactionSource.indexOf('// Real Stripe payout history'));
 return {calls,run:new Function('supabaseAdmin','canReadPreciseLocation',code+';return getSpentTransactions;')(db,()=>false)};
}
test('Transactions reads only the Driver booking IDs and labels rejected charge/refund without claiming added time',async()=>{
 const h=spentHistory();const rows=await h.run('driver');const ext=rows.find(r=>r.type==='extension');
 assert.equal(ext.description,'Extension not applied');assert.equal(ext.status,'refunded');assert.equal(ext.amount,1.15);assert.equal(ext.refundedAmount,1.15);
 assert.deepEqual(h.calls,[['bookings','renter_id','driver'],['booking_extensions','booking_id',[7]]]);
});
test('Transactions distinguishes a pending rejected-extension refund from money already returned',async()=>{
 const h=spentHistory({refundTotal:0,refundPending:1.15});const ext=(await h.run('driver')).find(r=>r.type==='extension');
 assert.equal(ext.status,'refund_pending');assert.equal(ext.refundedAmount,0);assert.equal(ext.refundPendingAmount,1.15);
});
