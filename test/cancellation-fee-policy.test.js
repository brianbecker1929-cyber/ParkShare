import test from 'node:test';
import assert from 'node:assert/strict';
import {decideRefund,originalProcessingFee} from '../api/_refund-policy.js';
import {CANCELLATION_REASONS} from '../src/lib/cancellationReasons.js';
import {createRefundHandler} from '../api/_booking-refund-handler.js';
const now=new Date('2026-11-11T12:00:00Z');
const booking={id:1,listing_id:2,renter_id:'driver',status:'confirmed',total:100,paid_at:'2026-11-01T12:00:00Z',booking_date:'2026-11-12',start_hour:12,hours:1,scheduled_starts_at:'2026-11-12T17:00:00Z',property_time_zone:'America/Toronto',stripe_charge_id:'ch_fixture',stripe_payment_intent_id:'pi_fixture',stripe_connected_account_id:'acct_fixture'};
const decide=(id,body,extra={})=>decideRefund({user:{id,...extra},booking,hostId:'host',body,now});
for(const role of ['driver','host'])for(const reason of CANCELLATION_REASONS[role])test(`${role}: ${reason.code} derives ${reason.payer} responsibility`,()=>{
 const result=decide(role,{reasonCode:reason.code,explanation:'Test reason'});assert.equal(result.reason.payer,reason.payer);assert.equal(result.actor,role);
 if(reason.payer==='review')assert.equal(result.review,true);else assert.equal(result.amount,10000);
});
for(const id of ['driver','host'])for(const reason of CANCELLATION_REASONS.staff)test(`${id} cannot forge ${reason.code}, even in user metadata`,()=>{
 const result=decide(id,{reasonCode:reason.code,explanation:'Pretending to be staff'},{user_metadata:{parkshare_staff:true,role:'staff'}});assert.equal(result.status,403);
});
for(const reason of CANCELLATION_REASONS.staff)test(`trusted staff can use ${reason.code}`,()=>assert.equal(decide('admin',{reasonCode:reason.code,explanation:'Approved after verification'},{app_metadata:{parkshare_staff:true}}).reason.payer,reason.payer));
test('Other needs an explanation and financial authority cannot come from request body',()=>{
 assert.equal(decide('host',{reasonCode:'host_other'}).status,400);
 assert.equal(decide('host',{reasonCode:'host_unavailable',feePayer:'parkshare'}).status,400);
});
test('late Driver free cancellation remains blocked; approved staff goodwill can refund it',()=>{
 const late={...booking,scheduled_starts_at:'2026-11-11T12:30:00Z'};
 const args={booking:late,hostId:'host',now};
 assert.equal(decideRefund({...args,user:{id:'driver'},body:{reasonCode:'driver_plans'}}).status,409);
 assert.equal(decideRefund({...args,user:{id:'admin',app_metadata:{parkshare_staff:true}},body:{reasonCode:'staff_driver_eligible',explanation:'Checked'}}).status,409);
 assert.equal(decideRefund({...args,user:{id:'admin',app_metadata:{parkshare_staff:true}},body:{reasonCode:'staff_goodwill',explanation:'Approved'}}).reason.payer,'parkshare');
});
test('Host partial refunds keep Host responsible and reject a full amount',()=>{
 const body={action:'refund',reasonCode:'host_partial',explanation:'Voluntary refund',requestId:'11111111-1111-4111-8111-111111111111',amountCents:2500};
 assert.equal(decide('host',body).reason.payer,'host');assert.equal(decide('host',body).amount,2500);
 assert.equal(decide('host',{...body,amountCents:10000}).status,400);
 assert.equal(decide('driver',body).status,400);
});
test('actual original Stripe fee excludes application fee; mismatched charge, mode, currency fail closed',()=>{
 const charge={id:'ch_fixture',payment_intent:'pi_fixture',livemode:false,currency:'cad',amount:10000,paid:true,captured:true,status:'succeeded',balance_transaction:{source:'ch_fixture',currency:'cad',fee_details:[{type:'stripe_fee',amount:320,currency:'cad'},{type:'application_fee',amount:1500,currency:'cad'}]}};
 assert.equal(originalProcessingFee(charge,booking,false),320);
 for(const change of [{id:'ch_wrong'},{livemode:true},{currency:'usd'},{disputed:true},{balance_transaction:null}])assert.throws(()=>originalProcessingFee({...charge,...change},booking,false));
});
function fakeDb(tables, rpc=()=>{throw Error('No financial mutation expected');}){
 return {rpc,from(table){let criteria=[],limit=999;const q={select(){return q;},eq(k,v){criteria.push([k,v]);return q;},order(){return q;},limit(n){limit=n;return q;},or(){return q;},single(){return Promise.resolve({data:tables[table]?.find(r=>criteria.every(([k,v])=>r[k]===v))});},then(resolve){return Promise.resolve({data:(tables[table]||[]).filter(r=>criteria.every(([k,v])=>r[k]===v)).slice(0,limit)}).then(resolve);}};return q;}};
}
const res=()=>({code:200,status(n){this.code=n;return this;},json(data){this.data=data;return this;},setHeader(){}});
for(const id of ['host','driver'])test(`actual API rejects ${id}'s direct staff-only request before Stripe`,async()=>{
 let stripeCalls=0;const handler=createRefundHandler({db:fakeDb({bookings:[booking],listings:[{id:2,host_id:'host'}]}),payments:new Proxy({},{get(){stripeCalls++;throw Error('Stripe must not be called');}}),authenticate:async()=>({id,user_metadata:{parkshare_staff:true}})});
 const response=res();await handler({method:'POST',body:{bookingId:1,reasonCode:'staff_goodwill',explanation:'Forged'}},response);
 assert.equal(response.code,403);assert.equal(stripeCalls,0);
});
test('API refuses paid-extension cancellation before accessing Stripe or reserving a refund',async()=>{
 const future={...booking,scheduled_starts_at:'2099-11-12T17:00:00Z',booking_date:'2099-11-12'};
 const handler=createRefundHandler({db:fakeDb({bookings:[future],listings:[{id:2,host_id:'host'}],booking_extensions:[{id:99,booking_id:1}]}),payments:{},authenticate:async()=>({id:'host'})});
 const response=res();await handler({method:'POST',body:{bookingId:1,reasonCode:'host_blocked'}},response);assert.equal(response.code,409);assert.match(response.data.error,/extensions/);
});
