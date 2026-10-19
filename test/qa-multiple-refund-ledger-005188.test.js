import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import Stripe from 'stripe';
import {reconcilePaymentRefund,refundLedgerSnapshot} from '../api/_refund-ledger.js';
import {paidCheckoutReferenceLog} from '../api/_paid-checkout-reference.js';
import {evaluateCancellation} from '../api/_cancellation-policy.js';

const refund=(id='re_first',amount=2000,status='succeeded')=>({id,amount,status,currency:'cad',payment_intent:'pi_base',charge:'ch_base',created:1792000000});
const charge=(amount_refunded=2000)=>({id:'ch_base',payment_intent:'pi_base',currency:'cad',livemode:false,amount:10000,amount_captured:10000,amount_refunded,status:'succeeded',paid:true,captured:true});
const event=(type='refund.updated',object=refund())=>({id:'evt_synthetic',type,account:'acct_owner',livemode:false,data:{object}});
function harness({kind='booking',history=[refund()],currentCharge=charge(),pages=null,owner=null,rpcError=null,lookupError=null}={}){
 const calls=[],writes=[];let listed=0;
 const row=owner||{id:7,total:100,added_amount:100,paid_at:'2026-10-01',stripe_charge_id:'ch_base',refund_ledger_revision:3};
 const stripe={refunds:{retrieve:async(id,p,o)=>{calls.push(['retrieve',id,o]);return structuredClone(refund(id));},list:async(p,o)=>{calls.push(['list',p,o]);return pages?pages[listed++]:{data:structuredClone(history),has_more:false};},create:()=>assert.fail('No refund creation')},
  charges:{retrieve:async(id,p,o)=>{calls.push(['charge',id,o]);return structuredClone(currentCharge);}},
  paymentIntents:{retrieve:async(id,p,o)=>{calls.push(['intent',id,o]);return {id,livemode:false,latest_charge:'ch_base'};}}};
 const db={from(table){const filters=[];return {select(){return this;},eq(k,v){filters.push([k,v]);return this;},async maybeSingle(){calls.push(['lookup',table,filters]);return {data:table===(kind==='booking'?'bookings':'booking_extensions')?row:null,error:lookupError};}};},
  async rpc(name,p){writes.push({name,p});return {data:{applied:true,revision:p.p_expected_revision+1},error:rpcError};}};
 return {stripe,db,calls,writes,run:e=>reconcilePaymentRefund({event:e||event(),stripe,db,logger:{warn(){}}})};
}
test('multiple refunds submit a complete per-refund snapshot, not an increment or overwritten ID',async()=>{
 const h=harness({history:[refund(),refund('re_second',3000)],currentCharge:charge(5000)});await h.run();
 assert.equal(h.writes.length,1);const {name,p}=h.writes[0];assert.equal(name,'reconcile_payment_refunds');assert.equal(p.p_expected_revision,3);
 assert.equal(p.p_account,'acct_owner');assert.equal(p.p_kind,'booking');assert.equal(p.p_charge_refunded_cents,5000);
 assert.deepEqual(p.p_refunds.map(r=>[r.refund_id,r.amount_cents]),[['re_first',2000],['re_second',3000]]);
 for(const c of h.calls.filter(c=>['retrieve','list','charge','intent'].includes(c[0])))assert.equal(c[2].stripeAccount,'acct_owner');
 assert.ok(h.calls.findIndex(c=>c[0]==='lookup')<h.calls.findIndex(c=>c[0]==='list'));
});
test('charge.refunded re-fetches current history and charge, ignoring stale partial event amounts',async()=>{
 const h=harness({history:[refund('re_full',10000)],currentCharge:charge(10000)});
 await h.run(event('charge.refunded',charge(1000)));assert.equal(h.writes[0].p.p_charge_refunded_cents,10000);
 assert.equal(h.calls.some(c=>c[0]==='retrieve'),false);
});
test('extension refunds use the separate extension record and payment identity',async()=>{
 const h=harness({kind:'extension'});await h.run();assert.equal(h.writes[0].p.p_kind,'extension');
});
test('refund pagination is complete, duplicate IDs are deduplicated, and current required refund is retained',async()=>{
 const h=harness({pages:[{data:[refund('re_second',3000)],has_more:true},{data:[refund(),refund()],has_more:false}],currentCharge:charge(5000)});
 await h.run();assert.equal(h.writes[0].p.p_refunds.length,2);assert.equal(h.calls.filter(c=>c[0]==='list')[1][1].starting_after,'re_second');
});
for(const [label,mutate] of [
 ['wrong charge',h=>{h.stripe.charges.retrieve=async()=>({...charge(),id:'ch_other'});}],
 ['wrong mode',h=>{h.stripe.charges.retrieve=async()=>({...charge(),livemode:true});}],
 ['wrong currency',h=>{h.stripe.charges.retrieve=async()=>({...charge(),currency:'usd'});}],
 ['wrong gross',h=>{h.stripe.charges.retrieve=async()=>({...charge(),amount:9999});}],
 ['wrong intent',h=>{h.stripe.refunds.retrieve=async()=>({...refund(),payment_intent:'pi_other'});}],
 ['incomplete pagination',h=>{h.stripe.refunds.list=async()=>({data:[],has_more:true});}],
 ['missing delivered refund',h=>{h.stripe.refunds.list=async()=>({data:[refund('re_other')],has_more:false});}],
 ['conflicting duplicate',h=>{h.stripe.refunds.list=async()=>({data:[refund(),refund('re_first',1000)],has_more:false});}],
 ['unknown status',h=>{h.stripe.refunds.list=async()=>({data:[refund('re_first',2000,'unknown')],has_more:false});}],
 ['over-refund',h=>{h.stripe.refunds.list=async()=>({data:[refund('re_first',20000)],has_more:false});}],
])test(`invalid ${label} blocks all writes`,async()=>{const h=harness();mutate(h);await assert.rejects(h.run());assert.equal(h.writes.length,0);});
test('database and CAS failures propagate for Stripe retry without false success',async()=>{
 for(const code of ['40001','42501','57014']){const h=harness({rpcError:{code}});await assert.rejects(h.run(),e=>e.code===code);}
 const h=harness({lookupError:{code:'42501'}});await assert.rejects(h.run(),e=>e.code==='42501');assert.equal(h.writes.length,0);
});
test('malformed/untrusted events never make provider or database calls',async()=>{
 for(const change of [{account:'other'},{livemode:null},{id:'invalid'}]){const h=harness();assert.equal((await h.run({...event(),...change})).applied,false);assert.equal(h.calls.length,0);}
});
test('unmatched connected-account payment never writes, and absent charge ID needs verified latest charge',async()=>{
 const h=harness();h.db.from=()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null})});
 assert.equal((await h.run()).reason,'unmatched');assert.equal(h.writes.length,0);
 const missing=harness({owner:{id:7,total:100,paid_at:'2026-10-01',stripe_charge_id:null,refund_ledger_revision:0}});await missing.run();assert.ok(missing.calls.some(c=>c[0]==='intent'));
 missing.stripe.paymentIntents.retrieve=async()=>({id:'pi_base',livemode:false,latest_charge:'ch_other'});await assert.rejects(missing.run());
});
test('pending/failed refunds are separate from successful money',()=>{
 const history=[refund(),refund('re_pending',1000,'pending'),refund('re_failed',3000,'failed')];
 const result=refundLedgerSnapshot(charge(3000),history,{paymentIntentId:'pi_base',chargeId:'ch_base',livemode:false,gross:10000});
 assert.equal(result.settled,2000);assert.equal(result.pending,1000);
});
test('partial-refund booking cancellation requires review, without initiating a second automatic refund',()=>{
 const result=evaluateCancellation({booking:{status:'confirmed',refund_total_amount:20,renter_id:'driver'},userId:'driver'});
 assert.equal(result.allowed,false);assert.equal(result.code,'support_required');
});
// Actual exported HTTP handler, real Stripe signature verification, synthetic
// provider/database boundaries. No network or payment action is permitted.
const source=await readFile(new URL('../api/stripe-webhook.js',import.meta.url),'utf8');
const bodyCode=source.slice(source.indexOf('function readRawBody('),source.indexOf('// "Today"'));
const handlerCode=source.slice(source.indexOf('export default async function handler')).replace('export default async function handler','return async function handler');
function httpHandler(h){
 const signatureStripe=new Stripe('sk_test_synthetic');
 h.stripe.webhooks=signatureStripe.webhooks;
 const readRawBody=new Function(bodyCode+';return readRawBody;')();
 const handler=new Function('stripe','supabaseAdmin','reconcilePaymentRefund','readRawBody','paidCheckoutReferenceLog','process',handlerCode)(h.stripe,h.db,reconcilePaymentRefund,readRawBody,paidCheckoutReferenceLog,{env:{STRIPE_WEBHOOK_SECRET:'whsec_synthetic'}});
 return async(valid=true)=>{
  const payload=JSON.stringify(event());const request=Readable.from([Buffer.from(payload)]);request.method='POST';
  request.headers={'stripe-signature':valid?signatureStripe.webhooks.generateTestHeaderString({payload,secret:'whsec_synthetic'}):'invalid'};
  const res={code:200,status(n){this.code=n;return this},json(body){this.body=body;return this},send(body){this.body=body;return this},setHeader(){},end(){}};
  await handler(request,res);return res;
 };
}
test('signed refund HTTP delivery returns 200 only after atomic persistence; invalid signature and failed persistence reject',async()=>{
 const good=harness();assert.equal((await httpHandler(good)()).code,200);assert.equal(good.writes.length,1);
 const denied=harness();assert.equal((await httpHandler(denied)(false)).code,400);assert.equal(denied.calls.length,0);
 const broken=harness({rpcError:{code:'40001'}});assert.equal((await httpHandler(broken)()).code,500);
});

test('out-of-order created event uses the current successful refund, never the stale pending body',async()=>{
 const h=harness();await h.run(event('refund.created',refund('re_first',2000,'pending')));
 assert.equal(h.writes[0].p.p_refunds[0].status,'succeeded');
});
test('current pending, failed and canceled refunds persist their own lifecycle without treating them as settled',async()=>{
 for(const status of ['pending','failed','canceled']){
  const current=refund('re_first',2000,status),h=harness({history:[current],currentCharge:charge(status==='pending'?2000:0)});
  h.stripe.refunds.retrieve=async()=>current;await h.run(event('refund.failed',current));
  assert.equal(h.writes[0].p.p_refunds[0].status,status);
 }
});
