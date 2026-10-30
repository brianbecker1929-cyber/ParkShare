import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Stripe from 'stripe';
import {CAD_CHECKOUT_API_VERSION,requireCadCheckout} from '../api/_checkout-currency.js';
import {calculateBookingAmounts} from '../api/_booking-rules.js';
import {getBookableVehicles} from '../src/lib/driverProfile.js';
import {validateHourlyRate} from '../src/lib/listingPrice.js';
import {validExtensionHours} from '../api/_extension-safety.js';

const sources=await Promise.all(['create-checkout-session','create-extend-session'].map(n=>readFile(new URL('../api/'+n+'.js',import.meta.url),'utf8')));
function fixture(kind,{badSession,providerFailure=false,registrationFailure=false,eventTitle}={}){
  const events=[],listing={id:7,host_id:'host',title:'Driveway at 123 Private Fixture Lane',address:'123 Private Fixture Lane',price:15,spaces:1,spots:[{forRent:true}],availability:null,time_zone:'Europe/Bucharest'};
  const booking={id:42,listing_id:7,renter_id:'driver',hours:2,status:'confirmed',paid_at:new Date(Date.now()-600000).toISOString(),spot_label:'A'};
  const user={id:'driver',email:'qa+location_RO@example.invalid',user_metadata:{vehicle_make:'Honda',vehicle_model:'Civic',vehicle_colour:'Blue',license_plate:'TEST 123'}};
  const db={from(table){let action='read';const chain={select(){return chain;},eq(){return chain;},is(){return chain;},update(){action='write';return chain;},insert(){action='write';return chain;},delete(){events.push(['delete',table]);return chain;},then(resolve){resolve({data:null,error:null});},single:async()=>({data:table==='listings'?listing:table==='bookings'?booking:table==='events'?{id:9,name:eventTitle,source:'ParkShare',status:'published',lat:43,lng:-79}:{stripe_account_id:'acct_host'}}),maybeSingle:async()=>{if(action==='write')events.push(['register',table]);return registrationFailure&&action==='write'?{error:Error('registration failed')}:{data:{id:'hold'}};}};return chain;},rpc:async name=>{events.push(['hold',name]);return {data:name==='create_booking_hold'?'hold':[{hold_id:'hold',starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+3600000).toISOString()}]};}};
  const stripe={accounts:{retrieve:async()=>({charges_enabled:true,payouts_enabled:true,details_submitted:true})},checkout:{sessions:{create:async(params,options)=>{
    events.push(['create',params,options]);if(providerFailure)throw Error('unsupported parameter');
    return {id:'cs_fixture',url:'https://checkout.stripe.com/test',currency:'cad',amount_total:1725,adaptive_pricing:{enabled:false},...badSession};
  },expire:async(...args)=>events.push(['expire',...args])}}};
  const values={jsonMethod:(req,res)=>{if(req.method==='POST')return true;res.status(405).json({});return false;},requireUser:async()=>user,stripe,supabaseAdmin:db,getOrigin:()=>'https://parkshare-qa.vercel.app',
    getSessionWindow:b=>({start:new Date(b.paid_at||Date.now()),end:new Date(new Date(b.paid_at||Date.now()).getTime()+b.hours*3600000)}),
    calculateBookingAmounts,isRentableSpot:()=>true,isValidBookingDuration:()=>true,getBookableVehicles,isListingAvailableForWindow:()=>true,validateHourlyRate,
    resolveLocalBookingStart:()=>new Date(Date.now()+86400000),validExtensionHours,checkAvailability:async()=>({available:true}),checkSpotAvailability:async()=>({available:true}),CAD_CHECKOUT_API_VERSION,requireCadCheckout,
    console:{error(){}}};
  const src=sources[kind==='booking'?0:1].replace(/^import .*\n/gm,'').replace('export default async function handler','return async function handler');
  const handler=new Function(...Object.keys(values),src)(...Object.values(values));
  const run=async()=>{const res={status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
    await handler({method:'POST',body:kind==='booking'?{listingId:7,hours:1,spotLabel:'A',vehicleId:'primary',eventId:eventTitle?9:undefined,currency:'ron',adaptive_pricing:{enabled:true}}:{bookingId:42,addedHours:1,currency:'ron',adaptive_pricing:{enabled:true}}},res);return res;};
  return{run,events};
}
for(const kind of ['booking','extension']){
  test(`${kind} ignores requested RON, disables conversion and pins only Checkout creation API version`,async()=>{
    const f=fixture(kind),res=await f.run();assert.equal(res.code,200);assert.ok(res.body.url);
    const [,params,options]=f.events.find(e=>e[0]==='create');
    assert.deepEqual(params.adaptive_pricing,{enabled:false});assert.equal(options.apiVersion,'2024-11-20.acacia');assert.equal(options.stripeAccount,'acct_host');
    assert.ok(params.line_items.every(l=>l.price_data.currency==='cad'));
    assert.equal(params.line_items.reduce((n,l)=>n+l.price_data.unit_amount*l.quantity,0),1725);
    assert.equal(params.payment_intent_data.application_fee_amount,225);
  });
  for(const badSession of [{currency:'ron'},{amount_total:6058},{adaptive_pricing:{enabled:true}},{adaptive_pricing:null}])test(`${kind} rejects unconfirmed CAD-only configuration and releases its hold`,async()=>{
    const f=fixture(kind,{badSession}),res=await f.run();assert.equal(res.code,500);assert.equal(res.body.url,undefined);
    assert.ok(f.events.some(e=>e[0]==='expire'));assert.ok(f.events.some(e=>e[0]==='delete'&&e[1]==='booking_holds'));
    assert.equal(f.events.some(e=>e[0]==='register'),false);
  });
  test(`${kind} provider failure never returns a URL and registration failure expires checkout`,async()=>{
    for(const opts of [{providerFailure:true},{registrationFailure:true}]){const f=fixture(kind,opts),res=await f.run();assert.equal(res.code,500);assert.equal(res.body.url,undefined);assert.ok(f.events.some(e=>e[0]==='delete'&&e[1]==='booking_holds'));if(opts.registrationFailure)assert.ok(f.events.some(e=>e[0]==='expire'));}
  });
}
test('BUG-005489 initial Checkout uses neutral customer-visible copy even when the title contains the street address',async()=>{
  const f=fixture('booking');assert.equal((await f.run()).code,200);
  const [,params,options]=f.events.find(e=>e[0]==='create');
  assert.equal(params.line_items[0].price_data.product_data.name,'ParkShare parking booking');
  assert.equal(params.line_items[0].price_data.product_data.description,'1 hour · Spot A');
  assert.doesNotMatch(JSON.stringify(params.line_items),/123 Private Fixture Lane|Driveway at/);
  assert.equal(options.stripeAccount,'acct_host');assert.equal(params.metadata.listing_id,'7');
  assert.equal(params.line_items.reduce((sum,line)=>sum+line.price_data.unit_amount*line.quantity,0),1725);
});
test('BUG-005489 free-text event names are not copied into the pre-payment order summary',async()=>{
  const eventTitle='Private party at 123 Private Fixture Lane',f=fixture('booking',{eventTitle});
  assert.equal((await f.run()).code,200);
  const [,params]=f.events.find(e=>e[0]==='create');
  assert.doesNotMatch(JSON.stringify(params.line_items),/123 Private Fixture Lane|Private party/);
  assert.equal(params.metadata.event_name,eventTitle,'The server-only event snapshot is retained for paid settlement');
});
test('installed Stripe SDK sends version override, connected account and false boolean on the wire',async()=>{
  let wire;
  const stripe=new Stripe('sk_test_synthetic',{maxNetworkRetries:0,httpClient:{getClientName:()=> 'synthetic',async makeRequest(host,port,path,method,headers,body){wire={path,method,headers,body};return{getRawResponse:()=>({}),getStatusCode:()=>200,getHeaders:()=>({'request-id':'req_fixture'}),toJSON:async()=>({id:'cs_fixture',currency:'cad',amount_total:1725,adaptive_pricing:{enabled:false}})};}}});
  const session=await stripe.checkout.sessions.create({mode:'payment',adaptive_pricing:{enabled:false},line_items:[{price_data:{currency:'cad',unit_amount:1725,product_data:{name:'Synthetic'}},quantity:1}],success_url:'https://example.invalid/success'}, {stripeAccount:'acct_host',apiVersion:CAD_CHECKOUT_API_VERSION});
  requireCadCheckout(session,1725);assert.equal(wire.headers['Stripe-Version'],CAD_CHECKOUT_API_VERSION);assert.equal(wire.headers['Stripe-Account'],'acct_host');
  assert.equal(new URLSearchParams(wire.body).get('adaptive_pricing[enabled]'),'false');
});

