import assert from 'node:assert/strict';
import {before,beforeEach,after,mock,test} from 'node:test';
import {hostEarnedTotal} from '../src/lib/hostTransactions.js';
const HOST='00000000-0000-4000-8000-000000001881';
const DRIVER='00000000-0000-4000-8000-000000001882';
const OTHER='00000000-0000-4000-8000-000000001883';
Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_earnings_fixture_only',SUPABASE_URL:'https://earnings-005188.invalid',
  SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'});
let handler,actor,db,charges,fees,refunds,calls,providerReads,chargeFailure,payoutFailure,tableFailure;
const res=()=>({code:200,body:null,headers:{},status(n){this.code=n;return this},json(body){this.body=body;return this},setHeader(k,v){this.headers[k]=v}});
async function get(signedIn=true){
  const r=res();await handler({method:'GET',query:{userId:OTHER},headers:signedIn?{authorization:'Bearer fixture'}:{}},r);return r;
}
const refund=(id,charge,pi,amount)=>({id,charge,payment_intent:pi,amount,currency:'cad',status:'succeeded'});
function payment(charge,pi,amount,fee,refunded){
  return {id:charge,payment_intent:pi,amount,amount_captured:amount,amount_refunded:refunded,paid:true,captured:true,
    status:'succeeded',currency:'cad',livemode:false,disputed:false,application_fee:'fee_'+charge,application_fee_amount:fee};
}
before(async()=>{
  mock.method(globalThis,'fetch',async(input,options={})=>{
    const url=new URL(input instanceof Request?input.url:input);
    assert.equal(url.origin,'https://earnings-005188.invalid');
    assert.equal(options.method||'GET','GET','Transaction reads must never mutate Supabase');
    if(url.pathname==='/auth/v1/user')return Response.json({id:actor});
    const table=url.pathname.split('/').pop();calls.push({table,query:url.searchParams});
    if(tableFailure?.table===table)return Response.json({code:tableFailure.code,message:'booking_extensions sensitive database detail'},{status:500});
    assert.ok(db[table],`Unexpected table ${table}`);
    let data=db[table].filter(row=>[...url.searchParams].every(([key,value])=>{
      if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
      if(value.startsWith('in.('))return value.slice(4,-1).split(',').includes(String(row[key]));
      if(value==='not.is.null')return row[key]!=null;
      return true;
    }));
    const select=url.searchParams.get('select')||'';
    data=data.map(row=>{
      const flat=select.replace(/listings\([^)]*\)/g,'listings').split(',').map(v=>v.trim());
      return Object.fromEntries(flat.map(key=>[key,key==='listings'?db.listings.find(l=>l.id===row.listing_id):row[key]??null]));
    });
    const single=new Headers(options.headers).get('accept')?.includes('application/vnd.pgrst.object+json');
    return Response.json(single?data[0]:data);
  });
  const {stripe}=await import('../api/_lib.js');
  mock.method(stripe.charges,'retrieve',async(id,params,options)=>{
    providerReads.push({kind:'charge',id,options});assert.equal(options.stripeAccount,'acct_host');
    if(chargeFailure)throw new Error('private Stripe detail');
    assert.ok(charges[id]);return structuredClone(charges[id]);
  });
  mock.method(stripe.refunds,'list',async(params,options)=>{
    providerReads.push({kind:'refunds',params,options});assert.equal(options.stripeAccount,'acct_host');
    return {data:structuredClone(refunds[params.charge]||[]),has_more:false};
  });
  mock.method(stripe.applicationFees,'retrieve',async(id,params,options)=>{
    providerReads.push({kind:'fee',id,options});assert.equal(options.stripeAccount,undefined);return structuredClone(fees[id]);
  });
  mock.method(stripe.payouts,'list',async()=>{
    providerReads.push({kind:'payouts'});if(payoutFailure)throw new Error('private payout detail');return {data:[]};
  });
  mock.method(stripe.refunds,'create',()=>assert.fail('Must not create a refund'));
  mock.method(stripe.applicationFees,'createRefund',()=>assert.fail('Must not refund a fee'));
  ({default:handler}=await import('../api/transactions.js'));
});
beforeEach(()=>{
  actor=HOST;calls=[];providerReads=[];chargeFailure=false;payoutFailure=false;tableFailure=null;
  db={
    profiles:[{id:HOST,stripe_account_id:'acct_host'},{id:DRIVER,stripe_account_id:null},{id:OTHER,stripe_account_id:'acct_other'}],
    listings:[{id:7,host_id:HOST,title:'Own driveway',address:'Own synthetic address'},
      {id:8,host_id:OTHER,title:'Other identifying title',address:'Other private address'}],
    bookings:[{id:1,listing_id:7,renter_id:DRIVER,total:115,subtotal:100,service_fee:15,status:'partially_refunded',paid_at:'2026-10-18T12:00:00Z',stripe_checkout_session_id:'cs_one',stripe_payment_intent_id:'pi_one',stripe_charge_id:'ch_one',stripe_connected_account_id:'acct_host'},
      {id:2,listing_id:7,renter_id:DRIVER,total:11.5,subtotal:10,service_fee:1.5,status:'confirmed',paid_at:'2026-10-18T13:00:00Z'},
      {id:3,listing_id:8,renter_id:HOST,total:23,subtotal:20,service_fee:3,status:'refunded',paid_at:'2026-10-18T14:00:00Z',stripe_checkout_session_id:'cs_other'}],
    booking_extensions:[],
  };
  charges={ch_one:payment('ch_one','pi_one',11500,1500,2300)};
  fees={fee_ch_one:{id:'fee_ch_one',account:'acct_host',charge:'ch_one',amount:1500,amount_refunded:300,currency:'cad',livemode:false}};
  refunds={ch_one:[refund('re_one','ch_one','pi_one',2300)]};
});
after(()=>mock.restoreAll());

test('authenticated Host sees remaining earnings for own listings, with no private Stripe IDs',async()=>{
  const r=await get();assert.equal(r.code,200);assert.equal(r.headers['Cache-Control'],'private, no-store');
  assert.equal(r.body.earned.length,2);assert.equal(hostEarnedTotal(r.body.earned),90);
  const partial=r.body.earned.find(t=>t.bookingId===1);
  assert.equal(partial.net,80);assert.equal(partial.refundedAmount,23);assert.equal(partial.platformFee,12);
  assert.equal(JSON.stringify(r.body.earned).includes('pi_one'),false);
  assert.equal(r.body.earned.some(t=>t.bookingId===3),false);
});
test('customer refund with no application fee returned keeps $77, not zero or original $100',async()=>{
  fees.fee_ch_one.amount_refunded=0;
  const r=await get();assert.equal(r.body.earned.find(t=>t.bookingId===1).net,77);
});
test('full customer and fee refund remains visible and contributes zero',async()=>{
  refunds.ch_one[0].amount=11500;charges.ch_one.amount_refunded=11500;fees.fee_ch_one.amount_refunded=1500;
  const r=await get();assert.equal(r.body.earned.length,2);assert.equal(hostEarnedTotal(r.body.earned),10);
  assert.equal(r.body.earned.find(t=>t.bookingId===1).earningsStatus,'refunded');
});
test('unknown refund amount stays in history under review while known proceeds remain available',async()=>{
  chargeFailure=true;const r=await get();assert.equal(r.code,200);
  const row=r.body.earned.find(t=>t.bookingId===1);assert.equal(row.net,null);assert.equal(row.earningsState,'needs_review');
  assert.equal(hostEarnedTotal(r.body.earned),10);
});
test('payout outage does not remove verified partial refund earnings or pretend there are no payouts',async()=>{
  payoutFailure=true;const r=await get();assert.equal(r.code,200);assert.equal(r.body.payoutsUnavailable,true);
  assert.equal(hostEarnedTotal(r.body.earned),90);assert.equal(JSON.stringify(r.body).includes('private payout'),false);
});
test('base booking and separately refunded extension are calculated independently',async()=>{
  db.booking_extensions=[{id:20,booking_id:1,added_hours:2,added_amount:23,status:'confirmed',paid_at:'2026-10-18T15:00:00Z',
    stripe_payment_intent_id:'pi_ext',stripe_charge_id:'ch_ext',stripe_connected_account_id:'acct_host',charge_amount_refunded:4.6}];
  charges.ch_ext=payment('ch_ext','pi_ext',2300,300,460);
  fees.fee_ch_ext={id:'fee_ch_ext',account:'acct_host',charge:'ch_ext',amount:300,amount_refunded:60,currency:'cad',livemode:false};
  refunds.ch_ext=[refund('re_ext','ch_ext','pi_ext',460)];
  const r=await get();assert.equal(r.code,200);assert.equal(r.body.earned.find(t=>t.type==='extension').net,16);
  assert.equal(hostEarnedTotal(r.body.earned),106);
});
test('repeat ledger fetch does not write or deduct refunds twice',async()=>{
  assert.equal(hostEarnedTotal((await get()).body.earned),90);
  assert.equal(hostEarnedTotal((await get()).body.earned),90);
});
test('wrong connected-account fee object is never credited to the Host',async()=>{
  fees.fee_ch_one.account='acct_other';const r=await get();assert.equal(r.code,200);
  assert.equal(r.body.earned.find(t=>t.bookingId===1).earningsState,'needs_review');
});
test('refunded spending retains its listing title without restoring exact address access',async()=>{
  const r=await get();assert.equal(r.body.spent[0].description,'Other identifying title');assert.equal(r.body.spent[0].address,'');
  assert.equal(JSON.stringify(r.body).includes('Other private address'),false);
});
test('Driver refund history preserves payment date and exposes the separate canonical parking start',async()=>{
  actor=DRIVER;
  Object.assign(db.bookings[0],{status:'refunded',paid_at:'2026-10-18T02:30:00Z',scheduled_starts_at:'2026-10-22T16:00:00Z',property_time_zone:'America/Toronto',booking_date:'2026-10-22',start_hour:12});
  const r=await get(),row=r.body.spent.find(t=>t.bookingId===1);
  assert.equal(row.description,'Own driveway');assert.equal(row.address,'');
  assert.equal(row.date,'2026-10-18T02:30:00Z');assert.equal(row.bookingStart,'2026-10-22T16:00:00.000Z');assert.equal(row.propertyTimeZone,'America/Toronto');
  assert.equal(r.body.spent.some(t=>t.bookingId===3),false);
  assert.equal(JSON.stringify(r.body).includes('cs_one'),false);
  const query=calls.find(c=>c.table==='bookings'&&c.query.has('renter_id')).query;
  assert.equal(query.get('renter_id'),'eq.'+DRIVER);
});
test('rejected payment stays unconfirmed without fabricating a parking start or address',async()=>{
  actor=DRIVER;Object.assign(db.bookings[0],{application_state:'rejected',status:'refunded',scheduled_starts_at:'2026-10-22T16:00Z'});
  const row=(await get()).body.spent.find(t=>t.bookingId===1);
  assert.equal(row.description,'Booking not confirmed');assert.equal(row.address,'');assert.equal(row.bookingStart,null);
});
test('deleted listing and corrupt legacy schedule keep financial history usable',async()=>{
  actor=DRIVER;db.listings=[];Object.assign(db.bookings[0],{status:'refunded',scheduled_starts_at:'invalid'});
  const r=await get(),row=r.body.spent.find(t=>t.bookingId===1);
  assert.equal(r.code,200);assert.equal(row.description,'Listing unavailable');assert.equal(row.bookingStart,null);assert.equal(row.address,'');assert.equal(row.amount,115);
});
test('refunded extension retains its parent listing, payment date and property zone',async()=>{
  actor=DRIVER;db.bookings[0].property_time_zone='America/Vancouver';
  db.booking_extensions=[{id:20,booking_id:1,added_hours:2,added_amount:23,status:'refunded',paid_at:'2026-10-18T15:00Z',refund_total_amount:23}];
  const row=(await get()).body.spent.find(t=>t.type==='extension');
  assert.equal(row.description,'Own driveway — added time');assert.equal(row.date,'2026-10-18T15:00Z');assert.equal(row.propertyTimeZone,'America/Vancouver');assert.equal(row.status,'refunded');assert.equal(row.refundedAmount,23);
});
test('entitled paid Driver retains exact location through the scoped history API',async()=>{
  actor=DRIVER;db.bookings[0].status='confirmed';
  const r=await get();assert.equal(r.code,200);assert.equal(r.body.spent.find(t=>t.bookingId===1).address,'Own synthetic address');
  assert.deepEqual(r.body.earned,[]);
});
test('signed-out request cannot read financial records or contact Stripe',async()=>{
  assert.equal((await get(false)).code,401);assert.equal(calls.length,0);assert.equal(providerReads.length,0);
});
test('extension permission errors are not silently represented as an empty ledger',async()=>{
  tableFailure={table:'booking_extensions',code:'42501'};
  const r=await get();assert.equal(r.code,500);assert.equal(JSON.stringify(r.body).includes('sensitive'),false);
});
test('genuinely missing legacy extension table preserves base booking history',async()=>{
  tableFailure={table:'booking_extensions',code:'PGRST205'};
  const r=await get();assert.equal(r.code,200);assert.equal(hostEarnedTotal(r.body.earned),90);
});

test('Driver spending reflects cumulative ledger refunds while the reservation remains confirmed',async()=>{
 actor=DRIVER;Object.assign(db.bookings[0],{status:'confirmed',refund_total_amount:46,refund_pending_amount:11.5});
 const r=await get();assert.equal(r.code,200);
 const t=r.body.spent.find(t=>t.bookingId===1);assert.equal(t.status,'refund_pending');assert.equal(t.refundedAmount,46);assert.equal(t.refundPendingAmount,11.5);assert.equal(t.amount,115);
 db.bookings[0].refund_pending_amount=0;assert.equal((await get()).body.spent.find(t=>t.bookingId===1).status,'partially_refunded');
 db.bookings[0].refund_total_amount=115;assert.equal((await get()).body.spent.find(t=>t.bookingId===1).status,'refunded');
});
