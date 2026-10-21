import test from 'node:test';
import assert from 'node:assert/strict';
import {latestHostExceptionDate,addCalendarDays,validateHostAvailabilityExceptions,validateHostExceptionDates} from '../src/lib/availabilityExceptionDates.js';
import {hostListingRow} from '../api/_host-listing.js';
import {createAvailabilityPreset} from '../src/lib/listingAvailability.js';

test('12-calendar-month horizon preserves month/day and clamps leap day rather than adding 365 days',()=>{
  for(const [today,latest] of [['2026-10-21','2027-10-21'],['2027-03-01','2028-03-01'],['2028-02-29','2029-02-28'],['2027-02-28','2028-02-28'],['2026-12-31','2027-12-31'],['2028-01-31','2029-01-31']])assert.equal(latestHostExceptionDate(today),latest);
  for(const bad of [null,'','2026-02-29','2028-02-30','2100-01-01T00:00Z'])assert.equal(latestHostExceptionDate(bad),null);
});
test('both endpoints must be within the inclusive window for every exception type',()=>{
  for(const today of ['2026-10-21','2027-03-01','2028-02-29'])for(const type of ['unavailable','available-all-day','custom']){
    const latest=latestHostExceptionDate(today),after=addCalendarDays(latest,1);
    for(const [startDate,endDate] of [[today,today],[today,latest],[latest,latest]])assert.equal(validateHostExceptionDates({type,startDate,endDate},today).valid,true);
    for(const [startDate,endDate] of [[today,after],[after,after],['2100-01-01','2100-01-02']]){
      const result=validateHostExceptionDates({type,startDate,endDate},today);assert.equal(result.valid,false);assert.match(result.error,/12 calendar months/);assert.ok(result.error.includes(latest));
    }
  }
});
test('property-local day controls both bounds across leap-day midnight and DST dates',()=>{
  const now=new Date('2028-03-01T00:30:00Z'),exception={id:'boundary',startDate:'2029-03-01',endDate:'2029-03-01'};
  const toronto=validateHostAvailabilityExceptions({timezone:'America/Toronto',exceptions:[exception]},now);
  const bucharest=validateHostAvailabilityExceptions({timezone:'Europe/Bucharest',exceptions:[exception]},now);
  assert.equal(toronto.today,'2028-02-29');assert.equal(toronto.latest,'2029-02-28');assert.equal(toronto.valid,false);
  assert.equal(bucharest.today,'2028-03-01');assert.equal(bucharest.latest,'2029-03-01');assert.equal(bucharest.valid,true);
  for(const instant of ['2026-03-08T06:30Z','2026-03-08T08:30Z'])assert.equal(validateHostAvailabilityExceptions({timezone:'America/Toronto',exceptions:[]},new Date(instant)).latest,'2027-03-08');
});
test('weekly schedules stay valid and an invalid range cannot hide among valid exceptions',()=>{
  const now=new Date('2026-10-21T12:00Z');assert.equal(validateHostAvailabilityExceptions({timezone:'America/Toronto',exceptions:[]},now).valid,true);
  const result=validateHostAvailabilityExceptions({timezone:'America/Toronto',exceptions:[{id:'good',startDate:'2027-10-21',endDate:'2027-10-21'},{id:'far',startDate:'2027-10-22',endDate:'2027-10-22'}]},now);
  assert.deepEqual(result.issues.map(issue=>issue.id),['far']);
});
const host='00000000-0000-4000-8000-000000000138',project='https://synthetic.invalid';
const payload=exceptions=>({title:'Synthetic horizon listing',address:'123 Test Street, Toronto ON M5V 2T6',price:12,description:'Synthetic only',features:[],
  photos:[`${project}/storage/v1/object/public/listing-photos/${host}/10000000-0000-4000-8000-000000000001.webp`],lat:43.65,lng:-79.38,spots:[{forRent:true}],availability:{...createAvailabilityPreset('anytime','Pacific/Auckland'),exceptions}});
test('publish validation uses the trusted zone and refuses out-of-window or malformed dates before normalization',()=>{
  const now=new Date('2028-03-01T00:30Z');
  const atLimit={id:'limit',type:'unavailable',startDate:'2029-02-28',endDate:'2029-02-28'};
  const row=hostListingRow(payload([atLimit]),host,'America/Toronto',project,now);assert.equal(row.availability.exceptions.length,1);assert.equal(row.availability.timezone,'America/Toronto');
  for(const dates of [{startDate:'2029-03-01',endDate:'2029-03-01'},{startDate:'2028-02-29',endDate:'2029-03-01'},{startDate:'2100-01-01',endDate:'2100-01-01'}])assert.throws(()=>hostListingRow(payload([{...atLimit,...dates}]),host,'America/Toronto',project,now),/12 calendar months/);
  assert.throws(()=>hostListingRow(payload([{...atLimit,startDate:'invalid'}]),host,'America/Toronto',project,now),/Choose valid From and To/);
  assert.equal(hostListingRow(payload([{...atLimit,startDate:'2029-03-01',endDate:'2029-03-01'}]),host,'Europe/Bucharest',project,now).availability.exceptions.length,1);
});
