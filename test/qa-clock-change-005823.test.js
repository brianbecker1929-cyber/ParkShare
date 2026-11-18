import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolveLocalBookingStart,resolveLocalBookingWindow} from '../api/_booking-local-time.js';
import {validateScheduledBooking,invalidScheduledHours} from '../src/lib/scheduledBooking.js';
import {getSessionWindow,calculateBookingAmounts,isRentableSpot,isValidBookingDuration} from '../api/_booking-rules.js';
import {getBookableVehicles} from '../src/lib/driverProfile.js';
import {normaliseVehicleType} from '../src/lib/vehicleTypes.js';
import {validateHourlyRate} from '../src/lib/listingPrice.js';
import {isListingAvailableForWindow} from '../src/lib/listingAvailability.js';
import {getListingSpotLayout} from '../src/lib/listingSpotLayout.js';
import {CAD_CHECKOUT_API_VERSION,requireCadCheckout} from '../api/_checkout-currency.js';
import {verifyBookingHoldSnapshot,CheckoutIntegrityError} from '../api/_checkout-integrity.js';
import {formatBookingEmailTimes} from '../api/_booking-email-times.js';
import {evaluateCancellation} from '../api/_cancellation-policy.js';
import {dueReminder} from '../api/_reminder-window.js';

const zone='America/Toronto';
const cases=[
  {day:'2027-03-14',start:1,end:4,hours:2,utcStart:'2027-03-14T06:00:00.000Z',utcEnd:'2027-03-14T08:00:00.000Z'},
  {day:'2027-11-07',start:0,end:3,hours:4,utcStart:'2027-11-07T04:00:00.000Z',utcEnd:'2027-11-07T08:00:00.000Z'},
  {day:'2027-03-13',start:23,end:28,hours:4,utcStart:'2027-03-14T04:00:00.000Z',utcEnd:'2027-03-14T08:00:00.000Z'},
  {day:'2027-11-06',start:23,end:27,hours:5,utcStart:'2027-11-07T03:00:00.000Z',utcEnd:'2027-11-07T08:00:00.000Z'},
  ...['2027-03-13','2027-03-15','2027-11-06','2027-11-08'].map(day=>({day,start:9,end:12,hours:3})),
];
const selection=c=>({bookingDate:c.day,startHour:c.start,endHour:c.end,timeZone:zone});
for(const c of cases)test(`selected ${c.day} ${c.start}..${c.end} preserves its end and bills ${c.hours} elapsed hours`,()=>{
  const actual=resolveLocalBookingWindow(selection(c));
  assert.equal(actual.hours,c.hours);
  if(c.utcStart)assert.equal(actual.start.toISOString(),c.utcStart);
  if(c.utcEnd)assert.equal(actual.end.toISOString(),c.utcEnd);
  assert.equal(validateScheduledBooking(selection(c)).hours,c.hours);
});
test('quarter-hour stays, non-transition zones, year boundaries and half-hour property offsets',()=>{
  assert.equal(resolveLocalBookingWindow({...selection(cases[0]),startHour:1.25,endHour:4.5}).hours,2.25);
  assert.equal(resolveLocalBookingWindow({...selection(cases[0]),timeZone:'America/Regina'}).hours,3);
  const stJohns=resolveLocalBookingWindow({...selection(cases[0]),timeZone:'America/St_Johns'});
  assert.equal(stJohns.start.toISOString(),'2027-03-14T04:30:00.000Z');assert.equal(stJohns.hours,2);
  const newYear=resolveLocalBookingWindow({bookingDate:'2027-12-31',startHour:23.5,endHour:25,timeZone:zone});
  assert.equal(newYear.end.toISOString(),'2028-01-01T06:00:00.000Z');assert.equal(newYear.hours,1.5);
});
test('nonexistent and repeated endpoints fail closed; picker marks both calendar days',()=>{
  for(const [day,hour] of [['2027-03-14',2.5],['2027-11-07',1.5]]){
    for(const input of [{startHour:hour,endHour:4},{startHour:0,endHour:hour}]){
      const result=validateScheduledBooking({bookingDate:day,timeZone:zone,...input});
      assert.equal(result.hours,null);assert.match(result.error,/does not exist|ambiguous/);
    }
    assert.ok(invalidScheduledHours({bookingDate:day,timeZone:zone}).has(hour));
  }
  assert.ok(invalidScheduledHours({bookingDate:'2027-03-13',timeZone:zone}).has(26.5));
  assert.ok(invalidScheduledHours({bookingDate:'2027-11-06',timeZone:zone}).has(25.5));
  assert.equal(validateScheduledBooking({bookingDate:'2027-03-14',startHour:1.75,endHour:3.25,timeZone:zone}).hours,null,'only 30 real minutes');
});
test('invalid dates, zones, reversed windows and non-quarter endpoints are rejected',()=>{
  for(const change of [{bookingDate:'2027-02-30'},{timeZone:'Bad/Zone'},{endHour:0},{endHour:4.1},{endHour:Infinity},{endHour:769},{startHour:NaN}]){
    assert.equal(validateScheduledBooking({...selection(cases[0]),...change}).hours,null);
  }
});
test('elapsed time does not depend on the visitor or server process timezone',()=>{
  const script='import {resolveLocalBookingWindow} from "./api/_booking-local-time.js";const w=resolveLocalBookingWindow('+JSON.stringify(selection(cases[0]))+');process.stdout.write(JSON.stringify([w.start,w.end,w.hours]));';
  const outputs=['UTC','America/Vancouver','Europe/Bucharest','Pacific/Auckland'].map(TZ=>execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,TZ},encoding:'utf8'}));
  assert.ok(outputs.every(value=>value===outputs[0]));
});

const sources=await Promise.all(['create-checkout-session','listing-availability','stripe-webhook'].map(name=>readFile(new URL(`../api/${name}.js`,import.meta.url),'utf8')));
function harness(){
  const holds=[],sessions=[],registrations=[],availabilityCalls=[];
  const listing={id:7,host_id:'host',price:5,spaces:1,spots:[{forRent:true}],availability:null,time_zone:zone};
  const db={from(table){let value;const chain={select(){return chain},eq(){return chain},update(v){value=v;return chain},single:async()=>({data:table==='listings'?listing:{id:'driver',stripe_account_id:'acct_host'}}),maybeSingle:async()=>{registrations.push(value);return {data:{id:'hold'}}}};return chain;},rpc:async(name,p)=>{assert.equal(name,'create_booking_hold');holds.push(p);return {data:'hold'}}};
  const stripe={accounts:{retrieve:async()=>({details_submitted:true,charges_enabled:true,payouts_enabled:true})},checkout:{sessions:{create:async(params)=>{sessions.push(params);return {id:'cs_synthetic',url:'https://checkout.stripe.com/synthetic',currency:'cad',adaptive_pricing:{enabled:false},amount_total:params.line_items.reduce((sum,item)=>sum+item.price_data.unit_amount,0)}},expire:()=>assert.fail('No expiry expected')}}};
  const deps={jsonMethod:()=>true,getOrigin:()=>'https://fixture.invalid',requireUser:async()=>({id:'driver',user_metadata:{vehicle_make:'Honda',vehicle_model:'Civic',vehicle_colour:'Blue',license_plate:'FIXTURE'}}),supabaseAdmin:db,stripe,getSessionWindow,calculateBookingAmounts,isRentableSpot,isValidBookingDuration,getBookableVehicles,validateHourlyRate,isListingAvailableForWindow,resolveLocalBookingStart,resolveLocalBookingWindow,getListingSpotLayout,CAD_CHECKOUT_API_VERSION,requireCadCheckout,checkAvailability:async(id,spaces,start,end)=>{availabilityCalls.push({start,end});return {available:true,spacesTotal:1,spacesFree:1}},checkAllSpotAvailability:async()=>({spotStatus:{A:true},spotState:{A:'available'}})};
  const compile=source=>new Function(...Object.keys(deps),source.replace(/^import .*\n/gm,'').replace('export default async function handler','return async function handler'))(...Object.values(deps));
  const checkout=compile(sources[0]),availability=compile(sources[1]);
  const run=async(fn,req)=>{const res={status(code){this.code=code;return this},json(body){this.body=body;return this},setHeader(){}};await fn(req,res);return res;};
  return {holds,sessions,registrations,availabilityCalls,listing,db,checkout:c=>run(checkout,{body:{listingId:7,spotLabel:'A',vehicleId:'primary',...c}}),availability:c=>run(availability,{query:{listingId:7,...c}})};
}
for(const c of cases.slice(0,4))test(`real checkout and availability reserve and price the exact ${c.day} selected interval`,async()=>{
  const h=harness(),params={bookingDate:c.day,startHour:c.start,endHour:c.end,hours:c.hours};
  assert.equal((await h.checkout(params)).code,200);
  const hold=h.holds[0],session=h.sessions[0];
  assert.equal(hold.p_starts_at,c.utcStart);assert.equal(hold.p_ends_at,c.utcEnd);
  assert.equal(session.line_items[0].price_data.unit_amount,c.hours*500);
  assert.equal(session.metadata.hours,String(c.hours));assert.equal(session.metadata.end_hour,String(c.end));
  assert.equal(session.line_items[1].price_data.unit_amount,Math.round(c.hours*500*0.15));
  assert.equal((await h.availability(params)).code,200);
  assert.equal(h.availabilityCalls[0].start.toISOString(),c.utcStart);assert.equal(h.availabilityCalls[0].end.toISOString(),c.utcEnd);
  const saved=h.registrations[0];
  const held={id:'hold',listing_id:7,renter_id:'driver',spot_label:'A',starts_at:hold.p_starts_at,ends_at:hold.p_ends_at,...saved};
  assert.equal(verifyBookingHoldSnapshot(held).hours,String(c.hours));
  // Execute the actual paid-settlement entry point with synthetic boundaries.
  let booking;
  const start=sources[2].indexOf('async function confirmBooking('),end=sources[2].indexOf('// Only a server-created pending extension',start);
  const deps={verifyBookingHoldSnapshot,CheckoutIntegrityError,stripe:{refunds:{create:()=>assert.fail('Settlement must not create a refund')}},reconcilePaymentRefund:()=>assert.fail('No refund reconciliation for a valid booking'),hostAccountForListing:async()=>({hostId:'host',connectedAccountId:'acct_host'}),validatedIntent:async()=>({paymentIntentId:'pi_synthetic',chargeId:'ch_synthetic'}),supabaseAdmin:h.db,readCheckoutDb:fn=>fn(),requirePaidCheckoutReference:()=>{},normaliseVehicleType,settleInitialBooking:async({row})=>{booking=row;return {applied:true,booking:row}},translatePaidBookingInsertError:e=>e,sendBookingConfirmationEmail:async()=>{}};
  const confirm=new Function(...Object.keys(deps),sources[2].slice(start,end)+';return confirmBooking;')(...Object.values(deps));
  await confirm({id:'cs_synthetic'},'acct_host',held,{id:'evt_synthetic'});
  assert.equal(booking.hours,c.hours);assert.equal(booking.end_hour,c.end);
  const window=getSessionWindow(booking);assert.equal(window.end.toISOString(),c.utcEnd);
  const midpoint=window.start.getTime()+c.hours*3600_000/2;
  assert.equal(dueReminder(booking,midpoint-1),null);
  assert.equal(dueReminder(booking,midpoint).kind,'halfway');
  assert.equal(dueReminder(booking,window.end.getTime()-15*60000).kind,'ending');
  assert.equal(dueReminder(booking,window.end.getTime()),null);
  const email=formatBookingEmailTimes(window.start,window.end,new Date('2026-11-18T12:00:00Z'),zone);
  assert.match(email.endTimeStr,new RegExp(`${c.end%24}:00\\s*a\\.?m`,'i'));
  const before=ms=>new Date(window.start.getTime()-ms);
  for(const minutes of [80,60])assert.equal(evaluateCancellation({booking,userId:'driver',now:before(minutes*60000)}).allowed,true);
  assert.equal(evaluateCancellation({booking,userId:'driver',now:before(59*60000)}).allowed,false);
});
test('old wall-clock duration quotes and nonexistent/repeated endpoints create no holds or Stripe sessions',async()=>{
  const bad=[{bookingDate:'2027-03-14',startHour:1,endHour:4,hours:3},{bookingDate:'2027-11-07',startHour:0,endHour:3,hours:3},{bookingDate:'2027-03-14',startHour:1,endHour:2.5,hours:1.5},{bookingDate:'2027-11-07',startHour:0,endHour:1.5,hours:1.5}];
  for(const params of bad){const h=harness();assert.equal((await h.checkout(params)).code,400);assert.equal((await h.availability(params)).code,400);assert.equal(h.holds.length,0);assert.equal(h.sessions.length,0);assert.equal(h.availabilityCalls.length,0);}
});
test('Book Now keeps elapsed-duration pricing; no scheduled endpoint is invented',async()=>{
  const h=harness();assert.equal((await h.checkout({hours:2})).code,200);assert.equal(h.sessions[0].metadata.hours,'2');assert.equal(h.sessions[0].metadata.scheduled_starts_at,'');assert.equal(h.sessions[0].line_items[0].price_data.unit_amount,1000);
});
