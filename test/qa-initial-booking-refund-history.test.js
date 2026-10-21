import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import Stripe from 'stripe';
import {settleInitialBooking,finishRejectedInitialBooking} from '../api/_initial-booking-payment.js';
import {reconcilePaymentRefund} from '../api/_refund-ledger.js';
import {verifyBookingHoldSnapshot,verifyPaidCheckout,CheckoutIntegrityError} from '../api/_checkout-integrity.js';
import {requirePaidCheckoutReference,translatePaidBookingInsertError,paidCheckoutReferenceLog} from '../api/_paid-checkout-reference.js';
const source=await readFile(process.env.QA_INITIAL_BOOKING_WEBHOOK_SOURCE||new URL('../api/stripe-webhook.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const code=section('function readRawBody(', '// "Today"')
 +section('async function confirmBooking(', '// Only a server-created pending extension')
 +section('async function processPaidCheckout(', '// A signed expired/async-failed')
 +source.slice(source.indexOf('export default async function handler')).replace('export default async function handler','return async function handler');
function harness({conflict=true,refundStatus='succeeded',history=[],rpcError=null,ledgerError=null,refundError=null}={}){
 const calls=[],state={booking:null,hold:null,history:structuredClone(history),ledger:[]};
 const session={id:'cs_initial',mode:'payment',payment_status:'paid',payment_intent:'pi_initial',amount_total:1150,currency:'cad',livemode:false,created:1792500000};
 const charge={id:'ch_initial',payment_intent:'pi_initial',amount:1150,amount_captured:1150,amount_refunded:history.filter(r=>['pending','succeeded'].includes(r.status)).reduce((n,r)=>n+r.amount,0),currency:'cad',livemode:false,paid:true,captured:true,status:'succeeded'};
 const hold={id:'initial_hold',listing_id:7,renter_id:'driver',spot_label:'A',starts_at:'2026-10-21T10:00:00Z',ends_at:'2026-10-21T11:00:00Z',expected_total_cents:1150,expected_connected_account_id:'acct_owner',stripe_checkout_session_id:'cs_initial',
 checkout_metadata:{hold_id:'initial_hold',listing_id:'7',renter_id:'driver',host_id:'host',connected_account_id:'acct_owner',hours:'1',total_cents:'1150',subtotal_cents:'1000',service_fee_cents:'150',spot_label:'A'}};
 state.hold=hold;
 const event={id:'evt_initial',type:'checkout.session.completed',account:'acct_owner',livemode:false,created:1792500000,data:{object:session}};
 const intent=()=>({id:'pi_initial',currency:'cad',livemode:false,status:'succeeded',amount_received:1150,application_fee_amount:150,latest_charge:'ch_initial'});
 const sdk=new Stripe('sk_test_synthetic');
 const stripe={webhooks:sdk.webhooks,paymentIntents:{retrieve:async(id,p,o)=>{calls.push(['intent',id,o.stripeAccount]);return intent();}},charges:{retrieve:async(id,p,o)=>{calls.push(['charge',id,o.stripeAccount]);return {...charge};}},
 refunds:{list:async(p,o)=>{calls.push(['history',o.stripeAccount]);return {data:structuredClone(state.history),has_more:false};},retrieve:async(id)=>state.history.find(r=>r.id===id),create:async(p,o)=>{
  calls.push(['refund',p,o]);if(state.refundError||refundError)throw new Error('provider_unavailable');
  const refund={id:'re_initial',amount:1150,status:refundStatus,currency:'cad',payment_intent:'pi_initial',charge:'ch_initial',created:1792500001};
  state.history=[refund];charge.amount_refunded=['succeeded','pending','requires_action'].includes(refundStatus)?1150:0;return refund;
 }}};
 const db={from(table){const filters=[];const q={select(){return this;},eq(k,v){filters.push([k,v]);return this;},maybeSingle:async()=>get(),single:async()=>get(),upsert(){return {select:async()=>({error:{code:"23P01"}})}},delete(){state.hold=null;return this},then(resolve){return Promise.resolve({error:null}).then(resolve)}};
 function get(){calls.push(['read',table]);if(state.lookupError)return {error:state.lookupError};
  if(table==='bookings')return {data:state.booking};if(table==='booking_holds')return {data:state.hold};
  if(table==='profiles')return {data:{id:'driver'}};if(['booking_extensions','pending_booking_extensions'].includes(table))return {data:null};throw new Error(table);
 }return q;},async rpc(name,p){calls.push(['rpc',name,p]);
  if(name==='settle_initial_booking_checkout'){
   if(rpcError)return {error:rpcError};
   const rejected=conflict||p.p_payment_reversed;
   state.booking={id:71,...p.p_booking,application_state:rejected?'rejected':'applied',status:rejected?'payment_failed':'confirmed',checkout_rejection_reason:p.p_payment_reversed?'payment_reversed':conflict?'booking_conflict':null,refund_ledger_revision:0};state.hold=null;
   return {data:{applied:!rejected,refund_required:rejected,booking:structuredClone(state.booking)}};
  }
  if(name==='reconcile_payment_refunds'){
   if(state.ledgerError||ledgerError)return {error:{code:'40001'}};
   state.ledger=p.p_refunds;state.booking.refund_ledger_revision++;
   state.booking.refund_total_amount=p.p_refunds.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amount_cents,0)/100;
   state.booking.refund_pending_amount=p.p_refunds.filter(r=>['pending','requires_action'].includes(r.status)).reduce((n,r)=>n+r.amount_cents,0)/100;
   if(state.booking.refund_total_amount===state.booking.total)state.booking.status='refunded';
   return {data:{applied:true}};
  }throw new Error(name);
 }};
 const deps={stripe,supabaseAdmin:db,CheckoutIntegrityError,verifyBookingHoldSnapshot,requirePaidCheckoutReference,translatePaidBookingInsertError,paidCheckoutReferenceLog,
 readCheckoutDb:f=>f(),hostAccountForListing:async()=>({hostId:'host',connectedAccountId:'acct_owner'}),
 validatedIntent:async(s,a,e,h,total,fee)=>verifyPaidCheckout({session:s,eventAccount:a,expectedSessionId:'cs_initial',expectedConnectedAccountId:e,actualHostAccountId:h,expectedTotalCents:total,expectedApplicationFeeCents:fee,paymentIntent:intent()}),
 settleInitialBooking,finishRejectedInitialBooking,reconcilePaymentRefund,
 sendBookingConfirmationEmail:async()=>calls.push(['confirmation']),
 refundInvalidRegisteredCheckout:async()=>calls.push(['integrity_refund']),
 confirmExtension:()=>assert.fail('Initial checkout cannot become extension'),rejectExtensionPayment:()=>assert.fail('Initial checkout cannot become extension'),
 process:{env:{STRIPE_WEBHOOK_SECRET:'whsec_synthetic'}},console:{error(){},warn(){}}};
 const handler=new Function(...Object.keys(deps),code)(...Object.values(deps));
 async function deliver(valid=true){const payload=JSON.stringify(event),req=Readable.from([Buffer.from(payload)]);req.method='POST';req.headers={'stripe-signature':valid?sdk.webhooks.generateTestHeaderString({payload,secret:'whsec_synthetic'}):'invalid'};
  const res={code:200,status(n){this.code=n;return this},json(b){this.body=b;return this},send(b){this.body=b;return this},setHeader(){},end(){}};
  await handler(req,res);return res;
 }
 return {state,calls,event,session,charge,stripe,deliver};
}
const refunded=(status='succeeded')=>({id:'re_previous',amount:1150,status,currency:'cad',payment_intent:'pi_initial',charge:'ch_initial',created:1792500000});
test('signed booking conflict records a failed payment before refund, reconciles it, releases hold and safely replays',async()=>{
 const h=harness();assert.equal((await h.deliver()).code,200);assert.equal((await h.deliver()).code,200);
 assert.ok(h.state.booking,'Rejected payment audit must persist');assert.equal(h.state.booking.application_state,'rejected');assert.equal(h.state.booking.status,'refunded');assert.equal(h.state.booking.refund_total_amount,11.5);assert.equal(h.state.hold,null);
 assert.equal(h.calls.filter(c=>c[0]==='refund').length,1);assert.equal(h.state.ledger.length,1);assert.equal(h.calls.some(c=>c[0]==='confirmation'),false);
 assert.ok(h.calls.findIndex(c=>c[1]==='settle_initial_booking_checkout')<h.calls.findIndex(c=>c[0]==='refund'));
 assert.equal(h.calls.find(c=>c[0]==='refund')[2].idempotencyKey,'booking-conflict-cs_initial');
});
test('valid booking confirms once with no refund and consumes its hold atomically',async()=>{
 const h=harness({conflict:false});assert.equal((await h.deliver()).code,200);assert.equal((await h.deliver()).code,200);
 assert.equal(h.state.booking.status,'confirmed');assert.equal(h.state.booking.application_state,'applied');assert.equal(h.state.hold,null);
 assert.equal(h.calls.filter(c=>c[0]==='confirmation').length,1);assert.equal(h.calls.some(c=>c[0]==='refund'),false);
});
for(const status of ['succeeded','pending','requires_action'])test(`already ${status} refund cannot confirm a new booking or trigger another refund`,async()=>{
 const h=harness({conflict:false,history:[refunded(status)]});assert.equal((await h.deliver()).code,200);assert.equal((await h.deliver()).code,200);
 assert.equal(h.state.booking.application_state,'rejected');assert.equal(h.state.booking.checkout_rejection_reason,'payment_reversed');
 assert.equal(h.calls.some(c=>c[0]==='refund'||c[0]==='confirmation'),false);
 assert.equal(h.state.booking.refund_pending_amount,status==='succeeded'?0:11.5);
});
test('pending automatic refund is displayed as pending and never as returned money',async()=>{
 const h=harness({refundStatus:'pending'});assert.equal((await h.deliver()).code,200);
 assert.equal(h.state.booking.status,'payment_failed');assert.equal(h.state.booking.refund_total_amount,0);assert.equal(h.state.booking.refund_pending_amount,11.5);
});
test('database failure before journaling never creates a refund or releases the hold',async()=>{
 const h=harness({rpcError:{code:'42501'}});assert.equal((await h.deliver()).code,500);assert.equal(h.state.booking,null);assert.ok(h.state.hold);assert.equal(h.calls.some(c=>c[0]==='refund'),false);
});
test('provider failure retains a rejected audit; signed retry resumes refund after hold consumption',async()=>{
 const h=harness();h.state.refundError=true;assert.equal((await h.deliver()).code,500);assert.equal(h.state.booking.application_state,'rejected');assert.equal(h.state.hold,null);
 h.state.refundError=false;assert.equal((await h.deliver()).code,200);assert.equal(h.state.booking.refund_total_amount,11.5);assert.equal(h.calls.some(c=>c[0]==='confirmation'),false);
});
test('failed ledger persistence returns 500 and replay records the existing refund without another money movement',async()=>{
 const h=harness();h.state.ledgerError=true;assert.equal((await h.deliver()).code,500);assert.equal(h.state.ledger.length,0);
 h.state.ledgerError=false;assert.equal((await h.deliver()).code,200);assert.equal(h.state.ledger.length,1);assert.equal(h.calls.filter(c=>c[0]==='refund').length,1);
});
test('invalid signatures, foreign accounts and database lookup outages never request refunds',async()=>{
 const h=harness();assert.equal((await h.deliver(false)).code,400);assert.equal(h.calls.length,0);
 const foreign=harness();foreign.event.account='acct_other';assert.equal((await foreign.deliver()).code,500);assert.equal(foreign.calls.some(c=>c[0]==='refund'),false);
 const unavailable=harness();unavailable.state.lookupError={code:'42501'};assert.equal((await unavailable.deliver()).code,500);assert.equal(unavailable.calls.some(c=>c[0]==='refund'),false);
});
test('disputed or inconsistent captured money never grants parking',async()=>{
 const h=harness({conflict:false});h.charge.disputed=true;assert.equal((await h.deliver()).code,200);assert.equal(h.state.booking.application_state,'rejected');assert.equal(h.calls.some(c=>c[0]==='refund'||c[0]==='confirmation'),false);
 const broken=harness();broken.charge.amount=999;assert.equal((await broken.deliver()).code,500);assert.equal(broken.state.booking,null);
});

const txSource=await readFile(new URL('../api/transactions.js',import.meta.url),'utf8');
test('Transactions includes owned failed-booking charge and actual refund state without describing a confirmed session',async()=>{
 for(const [settled,pending,status] of [[11.5,0,'refunded'],[0,11.5,'refund_pending']]){
  const row={id:71,listing_id:7,renter_id:'driver',hours:1,total:11.5,subtotal:10,service_fee:1.5,application_state:'rejected',status:'payment_failed',paid_at:'2026-10-21T10:00Z',refund_total_amount:settled,refund_pending_amount:pending};
  const calls=[];let projection='';
  const db={from(table){assert.equal(table,'bookings');return {select(fields){projection=fields;return this},eq(k,v){calls.push([k,v]);return this},not(k,op,v){assert.deepEqual([k,op,v],['paid_at','is',null]);return this},async order(){return {data:[Object.fromEntries(projection.split(',').map(k=>[k.trim(),row[k.trim()]]))]}}}}};
  const code=txSource.slice(txSource.indexOf('function spendingRefundAmounts'),txSource.indexOf('// Money the user has EARNED'));
  const get=new Function('supabaseAdmin','canReadPreciseLocation','fetchExtensionsForBookings',code+';return getSpentTransactions;')(db,()=>false,async ids=>{assert.deepEqual(ids,[71]);return []});
  const [transaction]=await get('driver');assert.equal(transaction.description,'Booking not confirmed');assert.equal(transaction.amount,11.5);assert.equal(transaction.status,status);assert.equal(transaction.refundedAmount,settled);assert.equal(transaction.refundPendingAmount,pending);assert.deepEqual(calls,[['renter_id','driver']]);
 }
});
