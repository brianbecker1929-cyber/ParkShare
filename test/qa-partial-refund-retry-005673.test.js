import test from 'node:test';
import assert from 'node:assert/strict';
import {createRefundHandler} from '../api/_booking-refund-handler.js';

const REQUEST='11111111-1111-4111-8111-111111111111';
const body={bookingId:1,action:'refund',reasonCode:'host_partial',explanation:'Voluntary refund',amountCents:6000,requestId:REQUEST};
const booking={id:1,listing_id:2,renter_id:'driver',status:'confirmed',total:100,paid_at:'2026-11-01T12:00:00Z',
  booking_date:'2099-11-12',start_hour:12,hours:1,scheduled_starts_at:'2099-11-12T17:00:00Z',property_time_zone:'America/Toronto',
  stripe_charge_id:'ch_fixture',stripe_payment_intent_id:'pi_fixture',stripe_connected_account_id:'acct_fixture',
  refund_total_amount:0,refund_pending_amount:0};
const savedOperation={id:'22222222-2222-4222-8222-222222222222',booking_id:1,request_key:`partial-${REQUEST}`,
  requested_by:'host',actor:'host',action:'refund',reason_code:'host_partial',explanation:'Voluntary refund',fee_payer:'host',
  connected_account_id:'acct_fixture',payment_intent_id:'pi_fixture',charge_id:'ch_fixture',livemode:false,currency:'cad',
  gross_cents:10000,amount_cents:6000,processing_fee_cents:320,fee_credit_cents:0,refund_id:'re_fixture',refund_status:'succeeded',state:'complete'};
const response=()=>({code:200,setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}});

function harness({row={},operation=null,user={id:'host'},lookupError=false,reserveOverride=null,beforeChargeRead}={}){
  const current={...booking,...row},operations=operation?[{...savedOperation,...operation}]:[],refunds=[],transfers=[],reads=[],rpcs=[],queries=[];
  const ledger=[];
  const charge={object:'charge',id:'ch_fixture',payment_intent:'pi_fixture',currency:'cad',amount:10000,
    amount_refunded:Math.round(Number(current.refund_total_amount)*100),livemode:false,paid:true,captured:true,status:'succeeded',disputed:false,
    balance_transaction:{source:'ch_fixture',currency:'cad',fee_details:[{type:'stripe_fee',amount:320,currency:'cad'}]}};
  const tables={bookings:[current],listings:[{id:2,host_id:'host'}],booking_refund_operations:operations,payment_refunds:ledger,booking_extensions:[]};
  const db={from(table){let criteria=[],values;
    const matching=()=>tables[table].filter(row=>criteria.every(([k,v])=>row[k]===v));
    const read=()=>{queries.push({table,criteria:[...criteria]});return table==='booking_refund_operations'&&lookupError?{error:Error('lookup unavailable')}:{data:structuredClone(matching()[0]??null)};};
    const q={select(){return q;},eq(k,v){criteria.push([k,v]);return q;},update(v){values=v;return q;},order(){return q;},limit(){return q;},or(){return q;},
      async single(){return read();},async maybeSingle(){return read();},then(resolve){if(values)matching().forEach(row=>Object.assign(row,values));return Promise.resolve({data:structuredClone(matching())}).then(resolve);}};return q;
  },async rpc(name,args){rpcs.push(name);
    if(name==='reserve_booking_refund'){
      if(reserveOverride){operations.push({...savedOperation,...reserveOverride});return {data:structuredClone(operations.at(-1))};}
      let op=operations.find(op=>op.booking_id===args.p_operation.booking_id&&op.request_key===args.p_operation.request_key);
      if(!op){op={...args.p_operation,id:operations.length?'44444444-4444-4444-8444-444444444444':savedOperation.id,currency:'cad',state:'queued',refund_attempt_at:new Date().toISOString()};operations.push(op);}
      return {data:structuredClone(op)};
    }
    const op=operations.find(op=>op.id===args.p_id);
    if(name==='claim_booking_refund'){
      if(!op||op.state!=='queued'||op.lease_token)return {data:null};
      op.lease_token=args.p_token;return {data:structuredClone(op)};
    }
    if(name==='allocate_refund_fee_credit'){op.fee_credit_cents=op.fee_payer==='host'?0:Math.round(320*op.amount_cents/10000);return {data:structuredClone(op)};}
    throw Error(name);
  }};
  const payments={charges:{async retrieve(id,params,options){reads.push({id,params,options});beforeChargeRead?.({operations,current,charge});return structuredClone(charge);}},
    refunds:{async create(params,options){refunds.push({params,options});const refund={object:'refund',id:`re_fixture_${refunds.length}`,payment_intent:charge.payment_intent,charge:charge.id,
      currency:'cad',amount:params.amount,status:'succeeded'};
      charge.amount_refunded+=params.amount;current.refund_total_amount=charge.amount_refunded/100;current.refund_status='succeeded';
      ledger.push({connected_account_id:'acct_fixture',livemode:false,refund_id:refund.id,status:'succeeded',amount_cents:params.amount,booking_id:1});return refund;
    },async retrieve(){throw Error('Replay must not retrieve a provider refund');}},
    transfers:{async create(params,options){transfers.push({params,options});return {id:'tr_fixture',...params,livemode:false,reversed:false};}}};
  const handler=createRefundHandler({db,payments,authenticate:async()=>user,live:false});
  return {current,operations,refunds,transfers,reads,rpcs,queries,async run(changes={}){const res=response();await handler({method:'POST',body:{...body,...changes}},res);return res;}};
}
const financialCounts=h=>({refunds:h.refunds.length,transfers:h.transfers.length,reads:h.reads.length,rpcs:h.rpcs.length});

test('completed partial refund retry confirms the original operation without another refund or transfer',async()=>{
  const h=harness();const first=await h.run();assert.equal(first.code,202);assert.equal(h.current.refund_total_amount,60);
  assert.equal(h.refunds.length,1);assert.equal(h.operations[0].state,'complete');
  const counts=financialCounts(h),retry=await h.run();
  assert.equal(retry.code,200);assert.equal(retry.data.alreadyProcessed,true);assert.equal(retry.data.operationId,first.data.operationId);
  assert.equal(retry.data.refundStatus,'succeeded');assert.match(retry.data.message,/already.*processed/i);assert.deepEqual(financialCounts(h),counts);
});

test('staff-funded refund retry cannot create a duplicate Host reimbursement',async()=>{
  const h=harness({user:{id:'staff',app_metadata:{parkshare_staff:true}}});const request={reasonCode:'staff_goodwill',explanation:'Approved goodwill'};
  assert.equal((await h.run(request)).code,202);assert.equal(h.transfers.length,1);
  const counts=financialCounts(h);assert.equal((await h.run(request)).code,200);assert.deepEqual(financialCounts(h),counts);
});

test('a saved partial refund can be acknowledged after other refunds exhaust the payment',async()=>{
  const h=harness({row:{status:'refunded',refund_total_amount:100},operation:{}});
  const result=await h.run();assert.equal(result.code,200);assert.equal(result.data.operationId,savedOperation.id);
  assert.deepEqual(financialCounts(h),{refunds:0,transfers:0,reads:0,rpcs:0});
});

for(const [name,operation] of [
  ['pending refund',{state:'queued',refund_status:'pending'}],
  ['fee reimbursement awaiting reconciliation',{state:'queued',refund_status:'succeeded'}],
  ['staff review',{state:'review',review_code:'refund_identity_mismatch'}],
  ['failed customer refund',{state:'review',refund_status:'failed'}],
])test(`a retry of ${name} reports existing status without resubmitting money operations`,async()=>{
  const h=harness({row:{refund_total_amount:60,refund_status:operation.refund_status},operation});
  const result=await h.run();assert.equal(result.code,202);assert.equal(result.data.operationId,savedOperation.id);
  assert.equal(result.data.operationState,operation.state);assert.equal(result.data.refundStatus,operation.refund_status??'succeeded');
  assert.equal(result.data.alreadyProcessed,false);assert.equal(result.data.alreadySubmitted,true);
  assert.equal(result.data.reviewRequired,operation.state==='review');assert.deepEqual(financialCounts(h),{refunds:0,transfers:0,reads:0,rpcs:0});
  assert.doesNotMatch(result.data.message,/already been processed/);
});

for(const [field,value] of Object.entries({requested_by:'another-host',actor:'staff',fee_payer:'parkshare',amount_cents:5900,
  explanation:'Different approval',reason_code:'staff_goodwill',connected_account_id:'acct_other',payment_intent_id:'pi_other',
  charge_id:'ch_other',livemode:true,gross_cents:9999,currency:'usd'}))test(`replay rejects a saved operation with mismatched ${field}`,async()=>{
  const h=harness({operation:{[field]:value}}),result=await h.run();assert.equal(result.code,409);assert.equal(result.data.code,'request_conflict');
  assert.deepEqual(financialCounts(h),{refunds:0,transfers:0,reads:0,rpcs:0});
});

test('reusing a request ID with a changed amount or explanation is a conflict',async()=>{
  for(const changes of [{amountCents:5900},{explanation:'Changed explanation'}]){
    const h=harness({operation:{}}),result=await h.run(changes);assert.equal(result.code,409);assert.equal(result.data.code,'request_conflict');assert.equal(h.refunds.length,0);
  }
});

test('current booking ownership and trusted staff authority are checked before a replay lookup',async()=>{
  for(const [user,changes] of [[{id:'intruder'},{}],[{id:'host',user_metadata:{parkshare_staff:true}},{reasonCode:'staff_goodwill'}]]){
    const h=harness({operation:{},user}),result=await h.run(changes);assert.equal(result.code,403);
    assert.equal(h.queries.filter(q=>q.table==='booking_refund_operations').length,0);assert.equal(h.refunds.length,0);
  }
});

test('invalid request IDs and forged fee responsibility are rejected before replay lookup',async()=>{
  for(const changes of [{requestId:'not-a-uuid'},{feePayer:'parkshare'},{amountCents:0}]){
    const h=harness({operation:{}}),result=await h.run(changes);assert.equal(result.code,400);
    assert.equal(h.queries.filter(q=>q.table==='booking_refund_operations').length,0);assert.equal(h.refunds.length,0);
  }
});

test('a new partial request still has to fit below the remaining balance',async()=>{
  for(const amountCents of [4000,4001]){
    const h=harness({row:{refund_total_amount:60},operation:{}});
    const result=await h.run({requestId:'33333333-3333-4333-8333-333333333333',amountCents});assert.equal(result.code,400);assert.equal(h.refunds.length,0);
  }
  const h=harness({row:{refund_total_amount:60},operation:{}});
  assert.equal((await h.run({requestId:'33333333-3333-4333-8333-333333333333',amountCents:1000})).code,202);assert.equal(h.refunds.length,1);
});

test('a failed replay lookup fails closed instead of treating the request as new',async()=>{
  const h=harness({operation:{},lookupError:true}),result=await h.run();assert.equal(result.code,503);
  assert.deepEqual(financialCounts(h),{refunds:0,transfers:0,reads:0,rpcs:0});
});

test('a concurrent completed refund is found before returning a changed-charge error',async()=>{
  const h=harness({beforeChargeRead:({operations,charge})=>{operations.push({...savedOperation});charge.amount_refunded=6000;}});
  const result=await h.run();assert.equal(result.code,200);assert.equal(result.data.operationId,savedOperation.id);
  assert.equal(h.refunds.length,0);assert.equal(h.transfers.length,0);assert.equal(h.rpcs.length,0);
});

test('reservation-race results must match the original request before any worker is run',async()=>{
  const mismatch=harness({reserveOverride:{amount_cents:5900}}),rejected=await mismatch.run();assert.equal(rejected.code,409);
  assert.equal(mismatch.refunds.length,0);assert.deepEqual(mismatch.rpcs,['reserve_booking_refund']);
  const same=harness({reserveOverride:{}}),accepted=await same.run();assert.equal(accepted.code,200);
  assert.equal(accepted.data.operationId,savedOperation.id);assert.equal(same.refunds.length,0);assert.deepEqual(same.rpcs,['reserve_booking_refund']);
});
