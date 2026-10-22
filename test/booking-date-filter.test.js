import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const { getBookingDateKey, matchesBookingDateRange } = await import(process.env.QA_BOOKING_DATE_FILTER_MODULE || "../src/lib/bookingDateFilter.js");

const booking = date => ({ bookingStart: `${date}T23:30:00Z`, bookingIsScheduled: true });

test("date ranges include both boundary days and exclude days outside", () => {
  assert.equal(matchesBookingDateRange(booking("2026-09-30"), "2026-10-01", "2026-10-07"), false);
  assert.equal(matchesBookingDateRange(booking("2026-10-01"), "2026-10-01", "2026-10-07"), true);
  assert.equal(matchesBookingDateRange(booking("2026-10-07"), "2026-10-01", "2026-10-07"), true);
  assert.equal(matchesBookingDateRange(booking("2026-10-08"), "2026-10-01", "2026-10-07"), false);
});

test("the same From and To date finds bookings starting on one day", () => {
  assert.equal(matchesBookingDateRange(booking("2026-10-07"), "2026-10-07", "2026-10-07"), true);
  assert.equal(matchesBookingDateRange(booking("2026-10-06"), "2026-10-07", "2026-10-07"), false);
});

test("open-ended date ranges and clearing both dates work", () => {
  assert.equal(matchesBookingDateRange(booking("2026-10-08"), "2026-10-07", ""), true);
  assert.equal(matchesBookingDateRange(booking("2026-10-08"), "", "2026-10-07"), false);
  assert.equal(matchesBookingDateRange(booking("2026-09-30"), "", "2026-10-07"), true);
  assert.equal(matchesBookingDateRange({}, "", ""), true);
});

test("scheduled bookings preserve the selected calendar day near midnight", () => {
  assert.equal(getBookingDateKey("2026-10-07T00:15:00Z", true), "2026-10-07");
  assert.equal(getBookingDateKey("2026-12-31T23:45:00Z", true), "2026-12-31");
});

test("immediate bookings use the same local calendar day as their displayed date", () => {
  const localStart = new Date(2026, 9, 7, 0, 15).toISOString();
  assert.equal(getBookingDateKey(localStart, false), "2026-10-07");
  assert.equal(matchesBookingDateRange({ bookingStart: localStart }, "2026-10-07", "2026-10-07"), true);
});

test("overnight bookings are filtered by their start day", () => {
  const overnight = { ...booking("2026-10-06"), bookingEnd: "2026-10-07T01:30:00Z" };
  assert.equal(matchesBookingDateRange(overnight, "2026-10-07", "2026-10-07"), false);
});

test("reversed ranges and missing dates do not produce misleading matches", () => {
  assert.equal(matchesBookingDateRange(booking("2026-10-07"), "2026-10-08", "2026-10-01"), false);
  assert.equal(matchesBookingDateRange({ bookingStart: "invalid" }, "2026-10-01", ""), false);
  assert.equal(matchesBookingDateRange({}, "", "2026-10-07"), false);
});

test("late Toronto parking is found on its displayed day rather than the next UTC day", () => {
  const b={bookingStart:"2026-10-21T01:00:00Z",bookingIsScheduled:true,propertyTimeZone:"America/Toronto"};
  assert.equal(getBookingDateKey(b.bookingStart,true,b.propertyTimeZone),"2026-10-20");
  assert.equal(matchesBookingDateRange(b,"2026-10-20","2026-10-20"),true);
  assert.equal(matchesBookingDateRange(b,"2026-10-21","2026-10-21"),false);
});

test("immediate bookings also use their recorded property day", () => {
  const b={bookingStart:"2026-10-21T06:30:00Z",bookingIsScheduled:false,propertyTimeZone:"America/Vancouver"};
  assert.equal(matchesBookingDateRange(b,"2026-10-20","2026-10-20"),true);
  assert.equal(matchesBookingDateRange(b,"2026-10-21","2026-10-21"),false);
});

test("a positive-offset property can display the following calendar day", () => {
  assert.equal(getBookingDateKey("2026-10-20T16:00:00Z",true,"Asia/Tokyo"),"2026-10-21");
});

test("property-local boundaries include year rollover and both DST repeated-hour instants", () => {
  for(const [instant,zone,day] of [
    ["2027-01-01T04:30:00Z","America/Toronto","2026-12-31"],
    ["2026-11-01T05:30:00Z","America/Toronto","2026-11-01"],
    ["2026-11-01T06:30:00Z","America/Toronto","2026-11-01"],
    ["2026-03-08T06:30:00Z","America/Toronto","2026-03-08"],
    ["2026-03-08T07:30:00Z","America/Toronto","2026-03-08"],
  ]) assert.equal(getBookingDateKey(instant,true,zone),day,instant);
});

test("invalid property zones and dates cannot create a false date-filter match", () => {
  for(const [instant,zone] of [["bad-date","America/Toronto"],[null,"America/Toronto"],["2026-10-21T01:00:00Z","Bad/Zone"]]){
    assert.equal(getBookingDateKey(instant,true,zone),"");
    assert.equal(matchesBookingDateRange({bookingStart:instant,bookingIsScheduled:true,propertyTimeZone:zone},"2026-10-21","2026-10-21"),false);
  }
});

test("travelling viewer zones cannot shift property-day filters and legacy fallbacks remain intact", () => {
  const code=`
    const {getBookingDateKey}=await import(process.env.QA_BOOKING_DATE_FILTER_MODULE||'./src/lib/bookingDateFilter.js');
    const start='2026-10-21T01:00:00Z';
    if(getBookingDateKey(start,true,'America/Toronto')!=='2026-10-20')throw Error('scheduled property day');
    if(getBookingDateKey(start,false,'America/Toronto')!=='2026-10-20')throw Error('immediate property day');
    if(getBookingDateKey(start,true)!=='2026-10-21')throw Error('legacy UTC day');
    const local=new Date(2026,9,20,23,30);
    if(getBookingDateKey(local.toISOString(),false)!=='2026-10-20')throw Error('legacy device day');
    process.stdout.write('passed');`;
  for(const zone of ["Europe/Athens","America/Vancouver","Pacific/Auckland"]){
    assert.equal(execFileSync(process.execPath,["--input-type=module","-e",code],{cwd:process.cwd(),encoding:"utf8",env:{...process.env,TZ:zone}}),"passed",zone);
  }
});
