import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { checkoutRateLimit } from '../api/_checkout-rate-limit.js';
import { calculateBookingAmounts } from '../api/_booking-rules.js';
import { getBookableVehicles } from '../src/lib/driverProfile.js';
import { validateHourlyRate } from '../src/lib/listingPrice.js';
import { validExtensionHours } from '../api/_extension-safety.js';

const now = Date.parse('2026-10-30T19:32:00Z');
const refusal = (reason='two_hour_limit', retry='2026-10-30T20:06:11Z', limits=[reason]) => ({code:'P0058', details:JSON.stringify({version:1, reason, limits, retry_at:retry})});
test('four recorded starts explain the reported 19:32 block and its automatic 20:06 recovery', () => {
  const result=checkoutRateLimit(refusal(),now);
  assert.match(result.error,/four parking checkout starts in two hours/);
  assert.match(result.error,/35 minutes/);
  assert.match(result.error,/clears automatically/);
  assert.equal(result.retryAfterSeconds,2051);
  assert.equal(result.retryAt,'2026-10-30T20:06:11.000Z');
  assert.doesNotMatch(result.error,/active|permanent|database|SQL/);
});
test('active unpaid checkouts and daily limits have distinct, plain-language explanations', () => {
  assert.match(checkoutRateLimit(refusal('active_checkouts'),now).error,/two unpaid parking checkouts open/);
  assert.match(checkoutRateLimit(refusal('daily_limit'),now).error,/twelve parking checkout starts in 24 hours/);
  assert.equal(checkoutRateLimit(refusal('two_hour_limit','2026-10-30T19:32:00.001Z'),now).retryAfterSeconds,1);
  assert.match(checkoutRateLimit(refusal('two_hour_limit','2026-10-30T19:32:59Z'),now).error,/about 1 minute/);
});
test('legacy, malformed and untrusted SQL details use safe copy without leaking raw errors', () => {
  for(const error of [null,{code:'P0058'}, {code:'P0058',details:'secret database error'},
    {code:'P0058',details:'x'.repeat(1025)}, {code:'P0058',details:'null'},
    {code:'P0058',details:JSON.stringify({version:1,reason:'__proto__',limits:['__proto__'],retry_at:'2026-10-30T20:00:00Z'})},
    {code:'P0058',details:JSON.stringify({version:1,reason:'daily_limit',limits:['unknown'],retry_at:'2026-10-30T20:00:00Z'})},
    refusal('two_hour_limit','not a timestamp'), refusal('two_hour_limit','2026-11-02T20:06:11Z'),
    refusal('two_hour_limit','2026-10-29T20:06:11Z'), {...refusal(),code:'42501'}]) {
    const result=checkoutRateLimit(error,now);
    assert.equal(result.code,'checkout_rate_limited');
    assert.match(result.error,/temporary parking checkout limit/);
    assert.equal(result.retryAt,undefined);
    assert.doesNotMatch(result.error,/secret|__proto__|unknown|42501/);
  }
});

for (const kind of ['booking','extension']) {
  test(`${kind} returns a timed 429 before Stripe creation, then succeeds once the database window clears`, async () => {
    const calls=[];
    let blocked=true;
    const listing={id:7,host_id:'host',price:15,spaces:1,spots:[{forRent:true}],availability:null,time_zone:'America/Toronto'};
    const booking={id:42,listing_id:7,renter_id:'driver',hours:2,status:'confirmed',paid_at:new Date(Date.now()-600000).toISOString(),spot_label:'A'};
    const user={id:'driver',email:'fixture@example.invalid',user_metadata:{vehicle_make:'Honda',vehicle_model:'Civic',vehicle_colour:'Blue',license_plate:'TEST 123'}};
    const db={from(table){const q={select(){return q;},eq(){return q;},is(){return q;},update(){return q;},insert(){return q;},delete(){return q;},then(resolve){resolve({data:null,error:null});},single:async()=>({data:table==='listings'?listing:table==='bookings'?booking:{stripe_account_id:'acct_host'}}),maybeSingle:async()=>({data:{id:'hold'}})};return q;},rpc:async(name)=>{
      calls.push(name);
      if(blocked) return {error:refusal('two_hour_limit',new Date(Date.now()+34*60000).toISOString())};
      return {data:name==='create_booking_hold'?'hold':[{hold_id:'hold',starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+3600000).toISOString()}]};
    }};
    const values={checkoutRateLimit,calculateBookingAmounts,getBookableVehicles,validateHourlyRate,validExtensionHours,
      jsonMethod:()=>true,requireUser:async()=>user,supabaseAdmin:db,getOrigin:()=>'https://example.invalid',
      stripe:{accounts:{retrieve:async()=>({details_submitted:true,charges_enabled:true,payouts_enabled:true})},checkout:{sessions:{create:async()=>{calls.push('stripe-create');return{id:'cs_test_fixture',url:'https://checkout.stripe.com/test'};}}}},
      getSessionWindow:b=>({start:new Date(b.paid_at),end:new Date(Date.parse(b.paid_at)+b.hours*3600000)}),
      isRentableSpot:()=>true,isValidBookingDuration:()=>true,isListingAvailableForWindow:()=>true,resolveLocalBookingStart:()=>new Date(Date.now()+86400000),
      checkAvailability:async()=>({available:true}),checkSpotAvailability:async()=>({available:true}),CAD_CHECKOUT_API_VERSION:'2024-11-20.acacia',requireCadCheckout:()=>{},console:{error(){}}};
    const source=(await readFile(new URL('../api/create-'+(kind==='booking'?'checkout-session':'extend-session')+'.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace('export default async function handler','return async function handler');
    const handler=new Function(...Object.keys(values),source)(...Object.values(values));
    const run=async()=>{
      const res={headers:{},setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
      await handler({method:'POST',body:kind==='booking'?{listingId:7,hours:1,spotLabel:'A',vehicleId:'primary'}:{bookingId:42,addedHours:1}},res);
      return res;
    };
    const denied=await run();
    assert.equal(denied.code,429);assert.equal(denied.body.code,'checkout_rate_limited');
    assert.equal(denied.body.reason,'two_hour_limit');assert.match(denied.body.error,/four parking checkout starts/);
    assert.equal(Number(denied.headers['Retry-After']),denied.body.retryAfterSeconds);
    assert.ok(denied.body.retryAfterSeconds>=2039&&denied.body.retryAfterSeconds<=2040);
    assert.equal(calls.filter(x=>x==='stripe-create').length,0);
    blocked=false;
    assert.equal((await run()).code,200);
    assert.equal(calls.filter(x=>x==='stripe-create').length,1);
  });
}
