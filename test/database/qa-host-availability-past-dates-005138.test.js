// Disposable PostgreSQL ONLY: TEST_DATABASE_URL targets a CI database.
// The fixture drops public/auth schemas. NEVER run with active QA/prod URL.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { addCalendarDays } from "../../src/lib/availabilityExceptionDates.js";

const { Pool } = pg;
const url = process.env.TEST_DATABASE_URL;
const HOST_ID = "00000000-0000-4000-8000-000000000138";

describe("BUG-005138 proposed server-side availability exception constraint", { skip: !url, concurrency: 1 }, () => {
  let pool, today, legacyId;
  const timezone = "America/Toronto";
  const availability = (from, to, zone = timezone) => ({
    timezone: zone,
    exceptions: [{ id: "date", type: "unavailable", startDate: from, endDate: to }],
  });
  const insert = schedule => pool.query(
    "insert into public.listings(host_id,spaces,availability) values($1,1,$2) returning id",
    [HOST_ID, JSON.stringify(schedule)]
  );

  before(async () => {
    pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000, max: 4 });
    await pool.query(await readFile(new URL("./booking-holds-fixture.sql", import.meta.url), "utf8"));
    await pool.query("alter table public.listings add column availability jsonb, add column time_zone text default 'America/Toronto'");
    await pool.query("insert into auth.users(id) values($1)", [HOST_ID]);
    await pool.query("insert into public.profiles(id) values($1)", [HOST_ID]);
    const q = await pool.query("select (clock_timestamp() at time zone 'America/Toronto')::date::text as today");
    today = q.rows[0].today;
    const legacy = await insert(availability(addCalendarDays(today, -30), addCalendarDays(today, -20)));
    legacyId = legacy.rows[0].id;
    const proposal = await readFile(new URL("../../docs/sql-proposals/bug-005138-future-exceptions.sql", import.meta.url), "utf8");
    await pool.query(proposal);
    await pool.query(proposal); // no duplicate trigger on reapply
  });
  after(async () => { await pool?.end(); });

  test("allows today and future special dates and recurring weekly schedules", async () => {
    const sameDay = await insert(availability(today, today));
    const future = await insert(availability(addCalendarDays(today, 1), addCalendarDays(today, 7)));
    const empty = await insert({ timezone, exceptions: [], weekly: {} });
    assert.equal(sameDay.rowCount, 1);
    assert.equal(future.rowCount, 1);
    assert.equal(empty.rowCount, 1);
  });

  test("blocks direct writes of past, inverted and malformed exception ranges", async () => {
    for (const bad of [
      availability(addCalendarDays(today, -1), addCalendarDays(today, 1)),
      availability(addCalendarDays(today, -1), addCalendarDays(today, -1)),
      availability(addCalendarDays(today, 2), addCalendarDays(today, 1)),
      availability("2026-02-30", "2026-03-01"),
      availability("invalid", addCalendarDays(today, 1)),
      availability(addCalendarDays(today, 1), addCalendarDays(today, 2), "Invalid/Timezone"),
    ]) {
      await assert.rejects(insert(bad), error => error.code === "23514");
    }
  });

  test("does not block unrelated metadata edits on legacy listings containing past exceptions", async () => {
    await pool.query("update public.listings set spaces=2 where id=$1", [legacyId]);
    const r = await pool.query("select spaces from public.listings where id=$1", [legacyId]);
    assert.equal(r.rows[0].spaces, 2);
  });

  test("updating legacy availability requires removing or replacing expired exceptions", async () => {
    await assert.rejects(
      pool.query("update public.listings set availability=$1 where id=$2",
        [JSON.stringify(availability(addCalendarDays(today, -4), addCalendarDays(today, 1))), legacyId]),
      error => error.code === "23514"
    );
    const result = await pool.query("update public.listings set availability=$1 where id=$2",
      [JSON.stringify(availability(addCalendarDays(today, 1), addCalendarDays(today, 3))), legacyId]);
    assert.equal(result.rowCount, 1);
  });

  test("new JSON without exception dates does not create an artificial past-date error", async () => {
    const r = await insert({ timezone, exceptions: null, weekly: {} });
    assert.equal(r.rowCount, 1);
  });

  test("trigger function is not directly invokable by untrusted client roles", async () => {
    const q = await pool.query("select has_function_privilege('anon','public.reject_past_listing_exceptions_005138()','EXECUTE') as anon, has_function_privilege('authenticated','public.reject_past_listing_exceptions_005138()','EXECUTE') as authenticated");
    assert.deepEqual(q.rows[0], { anon: false, authenticated: false });
  });

  test("Host-editable JSON timezone cannot replace the trusted driveway timezone", async () => {
    await assert.rejects(insert(availability(today,today,'Pacific/Pago_Pago')), error => error.code === '23514');
    await assert.rejects(pool.query(
      "insert into public.listings(host_id,spaces,time_zone,availability) values($1,1,null,$2)",
      [HOST_ID,JSON.stringify(availability(today,today))]
    ), error => error.code === '23514');
  });
});
