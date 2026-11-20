import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, describe, test } from "node:test";
import pg from "pg";

const { Pool } = pg;
const url = process.env.TEST_DATABASE_URL;
const inputs = [
  new URL("./booking-holds-fixture.sql", import.meta.url),
  new URL("../../supabase-migration-005-booking-holds.sql", import.meta.url),
  new URL("../../supabase-migration-011-registered-checkouts.sql", import.meta.url),
  new URL("../../docs/sql-proposals/bug-005118-unpaid-hold-rate-limits.sql", import.meta.url),
];
const HOST = "00000000-0000-4000-8000-000000000091";
const DRIVER = "00000000-0000-4000-8000-000000000092";
const OTHER = "00000000-0000-4000-8000-000000000093";
const nextStart = () => new Date(Date.now() + 24 * 3600_000);
const nextEnd = () => new Date(Date.now() + 25 * 3600_000);
const expires = () => new Date(Date.now() + 25 * 60_000);

describe("BUG-005118 hold-abuse rules (disposable PostgreSQL)", { skip: !url, concurrency: 1 }, () => {
  let pool, listing;
  before(async () => {
    pool = new Pool({ connectionString: url, max: 12, connectionTimeoutMillis: 5000 });
    for (const input of inputs) await pool.query(await readFile(input, "utf8"));
  });
  beforeEach(async () => {
    await pool.query("truncate public.booking_hold_attempts, public.pending_booking_extensions, public.booking_holds, public.bookings, public.listings, public.profiles, auth.users restart identity cascade");
    await pool.query("insert into auth.users(id) values ($1),($2),($3)", [HOST, DRIVER, OTHER]);
    await pool.query("insert into public.profiles(id) values($1),($2),($3)", [HOST, DRIVER, OTHER]);
    const q = await pool.query("insert into public.listings(host_id,spaces) values ($1,10) returning id", [HOST]);
    listing = q.rows[0].id;
  });
  after(async () => { await pool?.end(); });

  async function hold(driver = DRIVER, label = "A") {
    const q = await pool.query("select public.create_booking_hold($1,$2,$3,$4,$5,$6) id",
      [listing, driver, label, nextStart(), nextEnd(), expires()]);
    return q.rows[0].id;
  }
  async function expireHolds() {
    await pool.query("update public.booking_holds set expires_at = now() - interval '1 minute'");
  }

  test("limits two simultaneous unpaid holds across listing availability", async () => {
    assert.ok(await hold(DRIVER, "A"));
    assert.ok(await hold(DRIVER, "B"));
    await assert.rejects(hold(DRIVER, "C"), e => e.code === "P0058");
    const { rows } = await pool.query("select count(*)::int n from public.booking_hold_attempts where renter_id=$1", [DRIVER]);
    assert.equal(rows[0].n, 2, "denied holds must not be counted as issued");
    assert.ok(await hold(OTHER, "C"), "other Driver must not be penalized");
  });

  test("expired holds cease blocking capacity but remain in the rolling two-hour quota", async () => {
    for (const label of ["A", "B", "C", "D"]) {
      assert.ok(await hold(DRIVER, label));
      await expireHolds();
    }
    await assert.rejects(hold(DRIVER, "E"), e => e.code === "P0058");
    const { rows } = await pool.query("select count(*)::int n from public.booking_hold_attempts where renter_id=$1", [DRIVER]);
    assert.equal(rows[0].n, 4);
    assert.ok(await hold(OTHER, "E"));
  });

  test("a new two-hour window cannot defeat the daily cap", async () => {
    // Simulate 12 successful checkouts spread over the same 24 hours,
    // but more than 2h ago. They may have been cancelled/expired.
    await pool.query(`insert into public.booking_hold_attempts(renter_id,hold_id,created_at)
      select $1, gen_random_uuid(), now() - interval '3 hours'
      from generate_series(1,12)`, [DRIVER]);
    await assert.rejects(hold(DRIVER, "A"), e => e.code === "P0058");
    const { rows } = await pool.query("select count(*)::int n from public.booking_holds where renter_id=$1", [DRIVER]);
    assert.equal(rows[0].n, 0);
  });

  test("old successful holds beyond 24h do not cause a permanent Driver lockout", async () => {
    await pool.query(`insert into public.booking_hold_attempts(renter_id,hold_id,created_at)
      select $1, gen_random_uuid(), now() - interval '26 hours'
      from generate_series(1,12)`, [DRIVER]);
    assert.ok(await hold(DRIVER, "A"));
  });

  test("concurrent checkout starts cannot bypass the per-Driver active-hold limit", async () => {
    const calls = ["A", "B", "C", "D", "E", "F"].map(label => hold(DRIVER, label));
    const outcomes = await Promise.allSettled(calls);
    assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 2);
    assert.equal(outcomes.filter(o => o.status === "rejected" && o.reason.code === "P0058").length, 4);
    const { rows } = await pool.query("select count(*)::int n from public.booking_hold_attempts where renter_id=$1", [DRIVER]);
    assert.equal(rows[0].n, 2);
  });

  test("legacy active holds count against quota even without an audit record", async () => {
    await pool.query(`insert into public.booking_holds(listing_id,renter_id,spot_label,starts_at,ends_at,expires_at)
      values($1,$2,'A',now()+interval '1 day',now()+interval '1 day 1 hour',now()+interval '20 minutes')`, [listing, DRIVER]);
    assert.ok(await hold(DRIVER, "B"));
    await assert.rejects(hold(DRIVER, "C"), e => e.code === "P0058");
  });

  test("audit table and creation procedure are not callable by ordinary clients", async () => {
    const { rows } = await pool.query(`
      select has_table_privilege('anon','public.booking_hold_attempts','SELECT') as anon_read,
             has_table_privilege('authenticated','public.booking_hold_attempts','INSERT') as client_write,
             has_function_privilege('authenticated','public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)','EXECUTE') as client_hold`);
    assert.deepEqual(rows[0], { anon_read: false, client_write: false, client_hold: false });
  });
});
