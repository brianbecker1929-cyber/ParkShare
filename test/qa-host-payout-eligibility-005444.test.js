import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateBookingAmounts} from '../api/_booking-rules.js';
import {getBookableVehicles} from '../src/lib/driverProfile.js';
import {validateHourlyRate} from '../src/lib/listingPrice.js';
import {CAD_CHECKOUT_API_VERSION,requireCadCheckout} from '../api/_checkout-currency.js';

const sources=await Promise.all(['create-checkout-session','create-extend-session'].map(name=>readFile(new URL('../api/'+name+'.js',import.meta.url),'utf8')));
const ready={details_submitted:true,charges_enabled:true,payouts_enabled:true};
function fixture(kind,account=ready,{lookupFails=false,connected=true}={}){
  const effects=[];
  const listing={id:7,host_id:'host',title:'Synthetic parking',price:15,spaces:1,spots:[{forRent:true}],availability:null,time_zone:'America/Toronto'};
  const booking={id:42,listing_id:7,renter_id:'driver',hours:2,status:'confirmed',paid_at:new Date(Date.now()-600000).toISOString(),spot_label:'A'};
  // Deliberately stale-ready cache: only the live Stripe result may authorize payment.
  const host={stripe_account_id:connected?'acct_fixture':null,stripe_onboarding_complete:true,stripe_payouts_enabled:true};
  const db={from(table){const chain={select(){return chain;},eq(){return chain;},is(){return chain;},single:async()=>({data:table==='listings'?listing:table==='bookings'?booking:host,error:null}),
    update(){effects.push('write');return chain;},insert(){effects.push('write');return chain;},delete(){effects.push('write');return chain;},maybeSingle:async()=>({data:{id:'hold'},error:null}),then(resolve){resolve({data:null,error:null});}};return chain;},
    rpc:async name=>{effects.push('hold');return {data:name==='create_booking_hold'?'hold':[{hold_id:'hold',starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+3600000).toISOString()}],error:null};}};
  const stripe={accounts:{retrieve:async id=>{assert.equal(id,'acct_fixture');effects.push('account_read');if(lookupFails)throw Error('Provider unavailable');return account;}},
    checkout:{sessions:{create:async()=>{effects.push('checkout');return {id:'cs_fixture',url:'https://checkout.stripe.com/synthetic',currency:'cad',amount_total:1725,adaptive_pricing:{enabled:false}};},expire:async()=>effects.push('expire')}}};
  const values={stripe,supabaseAdmin:db,jsonMethod:()=>true,requireUser:async()=>({id:'driver',user_metadata:{vehicle_make:'Honda',vehicle_model:'Civic',vehicle_colour:'Blue',license_plate:'TEST 123'}}),getOrigin:()=>'https://qa.example.invalid',
    getSessionWindow:b=>({start:new Date(b.paid_at),end:new Date(new Date(b.paid_at).getTime()+b.hours*3600000)}),
    calculateBookingAmounts,getBookableVehicles,validateHourlyRate,CAD_CHECKOUT_API_VERSION,requireCadCheckout,isRentableSpot:()=>true,isValidBookingDuration:()=>true,isListingAvailableForWindow:()=>true,
    resolveLocalBookingStart:()=>new Date(Date.now()+86400000),validExtensionHours:()=>true,checkAvailability:async()=>({available:true}),checkSpotAvailability:async()=>({available:true}),console:{error(){}}};
  const source=sources[kind==='booking'?0:1].replace(/^import .*\n/gm,'').replace('export default async function handler','return async function handler');
  const handler=new Function(...Object.keys(values),source)(...Object.values(values));
  return {effects,async run(){const res={status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
    await handler({method:'POST',body:kind==='booking'?{listingId:7,hours:1,spotLabel:'A',vehicleId:'primary'}:{bookingId:42,addedHours:1}},res);return res;}};
}

for(const kind of ['booking','extension']){
  test(`${kind}: every incomplete Stripe onboarding combination rejects before holds or payment`,async()=>{
    for(const details_submitted of [false,true])for(const charges_enabled of [false,true])for(const payouts_enabled of [false,true]){
      if(details_submitted&&charges_enabled&&payouts_enabled)continue;
      const f=fixture(kind,{details_submitted,charges_enabled,payouts_enabled}),res=await f.run();
      assert.equal(res.code,409);assert.equal(res.body.code,'host_payouts_not_ready');assert.equal(res.body.url,undefined);
      assert.deepEqual(f.effects,['account_read']);
    }
  });
  test(`${kind}: missing and nonboolean readiness fields fail closed despite cached readiness`,async()=>{
    for(const field of Object.keys(ready))for(const value of [undefined,null,'true',1]){
      const f=fixture(kind,{...ready,[field]:value}),res=await f.run();assert.equal(res.code,409);assert.deepEqual(f.effects,['account_read']);
    }
  });
  test(`${kind}: a fully verified payout-ready Host can start checkout`,async()=>{
    const f=fixture(kind),res=await f.run();assert.equal(res.code,200);assert.ok(res.body.url);
    assert.equal(f.effects.filter(x=>x==='hold').length,1);assert.equal(f.effects.filter(x=>x==='checkout').length,1);
  });
  test(`${kind}: missing connected account and provider errors create no payment resources`,async()=>{
    const missing=fixture(kind,ready,{connected:false});assert.equal((await missing.run()).code,409);assert.deepEqual(missing.effects,[]);
    const unavailable=fixture(kind,ready,{lookupFails:true});assert.equal((await unavailable.run()).code,500);assert.deepEqual(unavailable.effects,['account_read']);
  });
}
