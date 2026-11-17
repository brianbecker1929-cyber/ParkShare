import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLocalBookingStart } from '../api/_booking-local-time.js';
import { getSessionWindow } from '../api/_booking-rules.js';
import { evaluateCancellation } from '../api/_cancellation-policy.js';

// IANA 2026b and B.C.'s permanent Pacific time: Vancouver remains UTC-7.
// https://www.iana.org/time-zones/releases/2026b
for (const [date,hour,expected] of [
  ['2026-11-12',10,'2026-11-12T17:00:00.000Z'],
  ['2026-11-22',16,'2026-11-22T23:00:00.000Z'],
  ['2026-11-22',10,'2026-11-22T17:00:00.000Z'],
]) test(`BUG-005674 current Vancouver rules: ${date} ${hour}:00`,()=>{
  const start=resolveLocalBookingStart({bookingDate:date,startHour:hour,timeZone:'America/Vancouver'});
  assert.equal(start.toISOString(),expected,'Requires runtime timezone data from IANA 2026b or newer');
  const booking={renter_id:'driver',status:'confirmed',hours:1,booking_date:date,start_hour:hour,scheduled_starts_at:start.toISOString(),property_time_zone:'America/Vancouver',paid_at:'2026-11-01T00:00Z'};
  assert.equal(getSessionWindow(booking).start.toISOString(),expected);
  for(const [minutes,allowed] of [[80,true],[61,true],[60,true],[59,false],[20,false]]) {
    const result=evaluateCancellation({booking,userId:'driver',hostId:'host',now:new Date(start.getTime()-minutes*60000)});
    assert.equal(result.allowed,allowed,minutes+' minutes notice');
    if(!allowed)assert.equal(result.code,'late');
  }
});
