import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {isRentableSpot,isValidBookingDuration} from '../api/_booking-rules.js';
import {getBookableVehicles} from '../src/lib/driverProfile.js';
import {validateHourlyRate} from '../src/lib/listingPrice.js';

const source=(await readFile(process.env.QA_SCHEDULED_CHECKOUT_SOURCE||new URL('../api/create-checkout-session.js',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');

test('BUG-005463 a mismatched schedule explains the time error before any conflict lookup, hold or Stripe call',async()=>{
  const effects=[];
  const deps={
    jsonMethod:()=>true,
    requireUser:async()=>({id:'driver-fixture',user_metadata:{vehicle_make:'Honda',vehicle_model:'Civic',vehicle_colour:'Blue',license_plate:'FIXTURE'}}),
    getOrigin:()=> 'https://fixture.invalid',
    isRentableSpot,isValidBookingDuration,getBookableVehicles,validateHourlyRate,
    supabaseAdmin:{
      from:table=>{
        effects.push(table);assert.equal(table,'listings','Invalid schedule must stop before Host/account lookups');
        const query={select(){return this;},eq(){return this;},single:async()=>({data:{id:7,host_id:'host-fixture',price:12,spaces:2,time_zone:'America/Toronto'}})};
        return query;
      },
      rpc:()=>{effects.push('hold');throw Error('Unexpected hold');},
    },
    stripe:{accounts:{retrieve:()=>{effects.push('stripe');throw Error('Unexpected Stripe request');}}},
  };
  const handler=new Function(...Object.keys(deps),source)(...Object.values(deps));
  for(const changes of [
    {startHour:12.5,endHour:13.25,hours:1}, // Screenshot: 45-minute window quoted as one hour.
    {startHour:12.5,endHour:13,hours:1},
    {startHour:12.5,endHour:13.75,hours:1},
    {startHour:12.5,endHour:null,hours:1},
  ]){
    effects.length=0;
    const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({body:{listingId:7,vehicleId:'primary',spotLabel:'A',bookingDate:'2030-11-04',...changes}},res);
    assert.equal(res.code,400);assert.equal(res.body.code,'invalid_scheduled_window');
    assert.match(res.body.error,/selected times do not match the booking length/);assert.match(res.body.error,/at least 1 hour/);
    assert.doesNotMatch(res.body.error,/overlap|vehicle already/i);
    assert.deepEqual(effects,['listings']);
  }
});
