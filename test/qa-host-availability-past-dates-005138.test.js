import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  addCalendarDays, dateInScheduleTimezone, isCalendarDate,
  validateHostAvailabilityExceptions, validateHostExceptionDates,
} from "../src/lib/availabilityExceptionDates.js";

test("computes Host calendar dates by configured schedule zone, not browser/UTC", () => {
  const now = new Date("2026-10-18T01:30:00.000Z");
  assert.equal(dateInScheduleTimezone("America/Toronto", now), "2026-10-17");
  assert.equal(dateInScheduleTimezone("America/Vancouver", now), "2026-10-17");
  assert.equal(dateInScheduleTimezone("America/Halifax", now), "2026-10-17");
  assert.equal(dateInScheduleTimezone("America/St_Johns", now), "2026-10-17");
  assert.equal(dateInScheduleTimezone("Europe/Athens", now), "2026-10-18");
  assert.equal(dateInScheduleTimezone("UTC", now), "2026-10-18");
});

test("daylight saving changes do not shorten or skip date-only exceptions", () => {
  assert.equal(dateInScheduleTimezone("America/Toronto", new Date("2026-03-08T06:30:00Z")), "2026-03-08");
  assert.equal(dateInScheduleTimezone("America/Toronto", new Date("2026-03-08T08:30:00Z")), "2026-03-08");
  assert.equal(dateInScheduleTimezone("America/Toronto", new Date("2026-11-01T05:30:00Z")), "2026-11-01");
  assert.equal(dateInScheduleTimezone("America/Toronto", new Date("2026-11-01T07:30:00Z")), "2026-11-01");
});

test("new exceptions choose tomorrow in schedule local calendar, including leap/year ends", () => {
  assert.equal(addCalendarDays("2026-10-17", 1), "2026-10-18");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addCalendarDays("2028-02-29", 1), "2028-03-01");
  assert.equal(addCalendarDays("2026-02-29", 1), null);
});

test("rejects impossible and ambiguous date inputs", () => {
  for (const invalid of ["", null, undefined, "2026-2-8", "02/08/2026", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-10-18T00:00:00Z"]) {
    assert.equal(isCalendarDate(invalid), false, String(invalid));
  }
  assert.equal(isCalendarDate("2028-02-29"), true);
});

test("rejects past exception ranges and inverted From/To dates", () => {
  const today = "2026-10-18";
  for (const exception of [
    { startDate: "2026-10-17", endDate: "2026-10-19" },
    { startDate: "2026-10-17", endDate: "2026-10-17" },
    { startDate: "2026-10-16", endDate: "2026-10-18" },
    { startDate: "2026-10-18", endDate: "2026-10-17" },
    { startDate: "2026-10-20", endDate: "2026-10-19" },
    { startDate: "2026-10-18", endDate: "" },
  ]) assert.equal(validateHostExceptionDates(exception, today).valid, false, JSON.stringify(exception));
});

test("allows today and future dates for blocking a vacation or opening a special day", () => {
  for (const type of ["unavailable", "available-all-day", "custom"]) {
    for (const dates of [
      { startDate: "2026-10-18", endDate: "2026-10-18" },
      { startDate: "2026-10-19", endDate: "2026-10-23" },
      { startDate: "2026-12-31", endDate: "2027-01-03" },
    ]) {
      assert.deepEqual(validateHostExceptionDates({ ...dates, type }, "2026-10-18"), { valid: true, error: null });
    }
  }
});

test("validates all exceptions; one expired window cannot hide among future ones", () => {
  const availability = {
    timezone: "America/Toronto",
    exceptions: [
      { id: "future", startDate: "2026-10-19", endDate: "2026-10-21" },
      { id: "past", startDate: "2026-10-16", endDate: "2026-10-17" },
    ],
  };
  const result = validateHostAvailabilityExceptions(availability, new Date("2026-10-18T15:00:00Z"));
  assert.equal(result.valid, false);
  assert.equal(result.today, "2026-10-18");
  assert.deepEqual(result.issues.map(x => x.id), ["past"]);
});

test("does not use browser timezone when schedule zone is invalid or absent", () => {
  for (const zone of ["", "Invalid/Zone", null, undefined]) {
    assert.equal(dateInScheduleTimezone(zone, new Date("2026-10-18T15:00:00Z")), null);
    assert.equal(validateHostAvailabilityExceptions({ timezone: zone, exceptions: [] }).valid, false);
  }
});

test("allows weekly schedules without exceptions, without rejecting recurring dates in history", () => {
  const weekly = {
    timezone: "America/Toronto",
    weekly: { mon: { enabled: true, windows: [{ start: "08:00", end: "16:00" }] } },
    exceptions: [],
  };
  assert.equal(validateHostAvailabilityExceptions(weekly, new Date("2026-10-18T15:00:00Z")).valid, true);
});

test("App blocks invalid exceptions before preview, publishing and image uploads", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /dateInScheduleTimezone\(availability\.timezone\)/);
  assert.match(app, /addCalendarDays\(dateInScheduleTimezone/);
  assert.doesNotMatch(app, /today\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(app, /const exceptionDateValidation = validateHostAvailabilityExceptions\(normalizedAvailability\)/);
  assert.match(app, /!exceptionDateValidation\.valid && \{ label: exceptionDateValidation\.issues\[0\]\.error, step: 6 \}/);
  assert.match(app, /min=\{exceptionDateValidation\.today \|\| undefined\}/);
  assert.match(app, /min=\{exception\.startDate >/);
  assert.match(app, /validateHostExceptionDates\(exception, exceptionDateValidation\.today\)\.error/);
  assert.match(app, /disabled=\{!hasAnyAvailability\(normalizedAvailability\) \|\| !exceptionDateValidation\.valid\}/);
  const publish = app.slice(app.indexOf("const publish = async () =>"), app.indexOf("const resetAll =", app.indexOf("const publish = async () =>")));
  assert.ok(publish.indexOf("validateHostAvailabilityExceptions(normalizeAvailability(form.availability))") >= 0);
  assert.ok(publish.indexOf("if (!currentExceptionDates.valid)") < publish.indexOf("uploadListingPhotos("));
  assert.ok(publish.indexOf("if (!currentExceptionDates.valid)") < publish.indexOf('publishHostListing('));
  assert.match(publish, /setStep\(6\)/);
});
