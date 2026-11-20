import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {validateBookingDuration} from '../src/lib/bookingDuration.js';
import {isValidBookingDuration} from '../api/_booking-rules.js';
import {formatBookNowTimes} from '../src/lib/bookNowTimes.js';

test('custom validation matches server limits without silently rounding or clamping the typed value',()=>{
  for(const input of ['','abc',NaN,Infinity,null,undefined,{},true,'0','0.5','-3','800','1.1','744.25']){
    const result=validateBookingDuration(input);assert.equal(result.hours,null,String(input));assert.ok(result.error);
  }
  for(const hours of [1,1.25,1.5,3,24,743.75,744]){
    const result=validateBookingDuration(String(hours));assert.equal(result.hours,hours);assert.equal(result.error,'');assert.equal(isValidBookingDuration(hours),true);
  }
  assert.match(validateBookingDuration('0.5').error,/minimum.*1 hour/);
  assert.match(validateBookingDuration('800').error,/maximum.*744 hours \(31 days\)/);
  assert.match(validateBookingDuration('1.1').error,/15-minute/);
});
test('availability API distinguishes an invalid duration from an invalid listing before any database access',async()=>{
  let reads=0;
  const source=(await readFile(new URL('../api/listing-availability.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'').replace('export default async function handler','return async function handler');
  const handler=new Function('jsonMethod','isValidBookingDuration','supabaseAdmin',source)(()=>true,isValidBookingDuration,{from(){reads++;throw Error('Unexpected read');}});
  for(const hours of ['0','0.5','-3','abc','800','1.1']){
    const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({query:{listingId:'7',hours}},res);
    assert.equal(res.code,400);assert.equal(res.body.code,'invalid_booking_duration');assert.match(res.body.error,/1 to 744 hours/);assert.doesNotMatch(res.body.error,/listingId/);
  }
  assert.equal(reads,0);
});
test('valid three-hour and 31-day estimates retain the real local end date across midnight and DST',()=>{
  const late='2026-10-31T01:32:00Z';
  assert.match(formatBookNowTimes('America/Toronto',3,late).end,/Oct 31, 2026.*12:32/);
  const maximum=formatBookNowTimes('America/Toronto',744,late);
  assert.match(maximum.end,/Nov 30, 2026.*8:32.*EST/);assert.doesNotMatch(maximum.end,/today/);
});
