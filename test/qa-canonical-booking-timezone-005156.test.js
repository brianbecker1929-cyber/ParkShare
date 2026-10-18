import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { getSessionWindow } from "../api/_booking-rules.js";
import { resolveLocalBookingStart } from "../api/_booking-local-time.js";
import { formatBookingEmailTimes } from "../api/_booking-email-times.js";
import { localCalendarDate } from "../src/lib/bookingCalendarDate.js";

const local = (day, hour, zone) => resolveLocalBookingStart({
  bookingDate: day, startHour: hour, timeZone: zone
}).toISOString();

test("canonical booking start overrides UTC wall-clock while preserving history",()=>{
  const legacy = {
    booking_date:"2026-10-20",start_hour:14,hours:2,
    paid_at:"2026-10-17T14:00:00Z"
  };
  const old = getSessionWindow(legacy);
  assert.equal(old.start.toISOString(),"2026-10-20T14:00:00.000Z");
  const modern=getSessionWindow({
    ...legacy,
    scheduled_starts_at:local("2026-10-20",14,"America/Toronto")
  });
  assert.equal(modern.start.toISOString(),"2026-10-20T18:00:00.000Z");
  assert.equal(modern.end.toISOString(),"2026-10-20T20:00:00.000Z");
  assert.equal(getSessionWindow(legacy).start.toISOString(),old.start.toISOString());
  assert.throws(()=>getSessionWindow({...legacy,scheduled_starts_at:"invalid"}),/invalid/);
});

test("property calendar date is stable under remote browser timezone",()=>{
  const code=[
    'import { localCalendarDate } from "./src/lib/bookingCalendarDate.js";',
    'const d = new Date(2026, 9, 20);',
    'process.stdout.write(localCalendarDate(d));'
  ].join("\n");
  for(const zone of ["Europe/Athens","America/Vancouver","Pacific/Auckland","America/Toronto"]) {
    const result=execFileSync(process.execPath,["--input-type=module","-e",code],{
      cwd: process.cwd(),encoding:"utf8",env:{...process.env,TZ:zone}
    });
    assert.equal(result,"2026-10-20",zone);
  }
  assert.equal(localCalendarDate(new Date(2026,9,20)),"2026-10-20");
  assert.throws(()=>localCalendarDate(new Date("not-date")),RangeError);
});

test("DST spring gap and repeated hour fail closed for checkout and availability",()=>{
  assert.throws(()=>local("2026-03-08",2.5,"America/Toronto"),/does not exist/);
  assert.throws(()=>local("2026-11-01",1.5,"America/Toronto"),/ambiguous/);
  assert.equal(local("2026-10-20",14,"America/Vancouver"),"2026-10-20T21:00:00.000Z");
});

test("booking email supports property time zones rather than assuming Toronto",()=>{
  const start=new Date("2026-10-20T21:00:00Z");
  const end=new Date("2026-10-20T23:00:00Z");
  const now=new Date("2026-10-17T12:00:00Z");
  const vancouver=formatBookingEmailTimes(start,end,now,"America/Vancouver");
  const toronto=formatBookingEmailTimes(start,end,now,"America/Toronto");
  assert.match(vancouver.startTimeStr,/2:00\s*p\.?m\.?/i);
  assert.match(toronto.startTimeStr,/5:00\s*p\.?m\.?/i);
  assert.throws(()=>formatBookingEmailTimes(start,end,now,"Bad/Zone"),RangeError);
});

test("checkout, availability, and webhook are synchronized on server-owned canonical UTC",async()=>{
  const [checkout, availability, webhook, reminders, app]=await Promise.all([
    readFile(new URL("../api/create-checkout-session.js",import.meta.url),"utf8"),
    readFile(new URL("../api/listing-availability.js",import.meta.url),"utf8"),
    readFile(new URL("../api/stripe-webhook.js",import.meta.url),"utf8"),
    readFile(new URL("../api/send-reminders.js",import.meta.url),"utf8"),
    readFile(new URL("../src/App.jsx",import.meta.url),"utf8"),
  ]);
  assert.match(checkout,/resolveLocalBookingStart\(/);
  assert.match(availability,/resolveLocalBookingStart\(/);
  assert.match(checkout,/time_zone/);
  assert.match(availability,/time_zone/);
  assert.match(checkout,/scheduled_starts_at: scheduledStartsAt/);
  assert.match(checkout,/p_starts_at: windowStart\.toISOString\(\)/);
  assert.match(webhook,/scheduled_starts_at: canonicalScheduled \? new Date\(hold\.starts_at\)\.toISOString\(\)/);
  assert.match(webhook,/claimedStart !== heldStart/);
  assert.match(reminders,/scheduled_starts_at, property_time_zone/);
  assert.doesNotMatch(reminders,/\.gte\("paid_at", since\)/);
  assert.match(app,/params\.set\("bookingDate", localCalendarDate\(date\)\)/);
  assert.doesNotMatch(app,/params\.set\("bookingDate", date\.toISOString\(\)\)/);
});

test("database plan preserves historic paid bookings and refuses anonymous timezone guessing",async()=>{
  const sql=await readFile(new URL("../docs/sql-proposals/bug-005156-property-local-canonical-bookings.sql",import.meta.url),"utf8");
  assert.match(sql,/ADD COLUMN IF NOT EXISTS time_zone text/);
  assert.match(sql,/ADD COLUMN IF NOT EXISTS scheduled_starts_at timestamptz/);
  assert.match(sql,/new\.scheduled_starts_at IS NOT NULL/);
  assert.match(sql,/AT TIME ZONE 'UTC'/);
  assert.doesNotMatch(sql,/UPDATE public\.bookings/);
  assert.doesNotMatch(sql,/UPDATE public\.listings SET time_zone = 'America\/Toronto'/);
});
