import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { listingAvailabilityMessage, canChooseListingSpot } from "../src/lib/spotAvailability.js";
import { createAvailabilityPreset, formatAvailabilityForDate, isListingAvailableForWindow } from "../src/lib/listingAvailability.js";
import { getSessionWindow, isValidBookingDuration } from "../api/_booking-rules.js";
import { resolveLocalBookingStart } from "../api/_booking-local-time.js";
import { getListingSpotLayout } from "../src/lib/listingSpotLayout.js";

const apiSource = (await readFile(process.env.QA_HOST_HOURS_API_SOURCE || new URL('../api/listing-availability.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace('export default async function handler', 'return async function handler');

async function checkClosedHours(schedule) {
  let capacityReads = 0;
  const listing = { id: 7, spaces: 2, spots: [{forRent:true},{forRent:true}], availability: schedule, time_zone: 'America/Toronto' };
  const values = {supabaseAdmin: {from:()=>({select:()=>({eq:()=>({single:async()=>({data:listing})})})})}, jsonMethod:()=>true,
    isValidBookingDuration, getSessionWindow, resolveLocalBookingStart, getListingSpotLayout, isListingAvailableForWindow, formatAvailabilityForDate,
    checkAvailability:()=>{capacityReads++;throw Error('A closed schedule must not query occupancy');}, checkAllSpotAvailability:()=>assert.fail('No occupancy query')};
  const handler = new Function(...Object.keys(values), apiSource)(...Object.values(values));
  const res = {setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({query:{listingId:'7',hours:'1',bookingDate:'2030-10-21',startHour:'4.5'}},res);
  assert.equal(res.code,200);assert.equal(capacityReads,0);assert.equal(res.body.hostScheduleOpen,false);
  return res.body;
}

test('BUG-005467 API and shared warning expose the selected day hours in the property zone',async()=>{
  const data = await checkClosedHours(createAvailabilityPreset('evenings','Europe/Bucharest'));
  assert.match(data.hostScheduleLabel,/Oct 21, 2030: 5pm–11pm \(America\/Toronto local time\)/);
  assert.deepEqual(data.spotStatus,{A:false,B:false});
  const message = listingAvailabilityMessage(data,'now');
  assert.match(message,/5pm–11pm.*America\/Toronto/);assert.match(message,/Schedule for Later/);
  assert.doesNotMatch(message,/All spots are taken/);
});

test('BUG-005467 date exceptions override regular hours without exposing the rest of the calendar',async()=>{
  const schedule = createAvailabilityPreset('evenings','America/Toronto');
  schedule.exceptions=[{type:'custom',startDate:'2030-10-21',endDate:'2030-10-21',windows:[{start:'18:00',end:'20:30'}]},
    {type:'unavailable',startDate:'2030-12-25',endDate:'2030-12-25'}];
  const data = await checkClosedHours(schedule);
  assert.match(listingAvailabilityMessage(data,'advance'),/6pm–8:30pm.*America\/Toronto/);
  assert.doesNotMatch(data.hostScheduleLabel,/5pm|11pm|Dec 25|2030-12-25/);
  schedule.exceptions.push({type:'unavailable',startDate:'2030-10-21',endDate:'2030-10-21'});
  const closed = await checkClosedHours(schedule);
  assert.match(closed.hostScheduleLabel,/unavailable on Oct 21, 2030/);
  assert.doesNotMatch(closed.hostScheduleLabel,/5pm|6pm|11pm/);
});

test('BUG-005467 schedule hint uses the property date across midnight and handles all-day overrides',()=>{
  const schedule = createAvailabilityPreset('business','Europe/Bucharest');
  const label = formatAvailabilityForDate(schedule,'2030-10-22T02:00:00Z','America/Toronto');
  assert.match(label,/Oct 21, 2030: 9am–5pm/);
  schedule.exceptions=[{type:'available-all-day',startDate:'2030-10-21',endDate:'2030-10-21'}];
  assert.match(formatAvailabilityForDate(schedule,'2030-10-22T02:00:00Z','America/Toronto'),/Oct 21, 2030: All day/);
  for(const zone of [undefined,null,'','Bad/Zone'])assert.equal(formatAvailabilityForDate(schedule,'2030-10-22T02:00:00Z',zone),null);
  assert.equal(formatAvailabilityForDate(schedule,'invalid','America/Toronto'),null);
});

test("closed Host hours explain the schedule rather than claiming occupancy", () => {
  const closed = { available: false, hostScheduleOpen: false, reason: "host_schedule", spacesFree: 0, spacesTotal: 2, spotStatus: { A: false, B: false } };
  for (const mode of ["now", "advance"]) {
    const text = listingAvailabilityMessage(closed, mode);
    assert.match(text, /Outside the Host's available hours/);
    assert.doesNotMatch(text, /taken|booked|full/i);
    assert.equal(canChooseListingSpot({ isRealListing: true, hostRentable: true, availableData: closed, label: "A" }), false);
  }
});

test("either API schedule signal takes precedence over capacity counts", () => {
  for (const data of [{ reason: "host_schedule" }, { hostScheduleOpen: false },
    { available: true, hostScheduleOpen: false, spacesFree: 2, spacesTotal: 2 }]) {
    assert.match(listingAvailabilityMessage(data, "now"), /Outside the Host's available hours/);
  }
});

test("genuinely occupied open hours retain the full-capacity message", () => {
  const full = { available: false, hostScheduleOpen: true, spacesFree: 0, spacesTotal: 2 };
  assert.match(listingAvailabilityMessage(full, "now"), /All spots are taken for right now/);
  assert.match(listingAvailabilityMessage(full, "advance"), /All spots are taken for that time/);
});

test("an open free bay remains bookable and the free count is shown", () => {
  const open = { available: true, hostScheduleOpen: true, spacesFree: 1, spacesTotal: 2, spotStatus: { A: true, B: false } };
  assert.match(listingAvailabilityMessage(open, "now"), /1 of 2 spots free/);
  assert.equal(canChooseListingSpot({ isRealListing: true, hostRentable: true, availableData: open, label: "A" }), true);
  assert.equal(canChooseListingSpot({ isRealListing: true, hostRentable: true, availableData: open, label: "B" }), false);
});

test("an unknown availability result does not claim spots are taken", () => {
  for (const data of [null, {}, { available: false }]) {
    assert.doesNotMatch(listingAvailabilityMessage(data, "now"), /taken|booked|full/i);
  }
});

test("booking warning and spot picker share the schedule-aware message", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const panel = app.slice(app.indexOf("function ListingDetail("), app.indexOf("function useAllListings("));
  assert.equal((panel.match(/listingAvailabilityMessage\(selectedAvailability, bookingMode\)/g) || []).length, 2);
  assert.doesNotMatch(panel, /All spots are taken|Full for that/);
});
