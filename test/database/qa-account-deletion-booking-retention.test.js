// Disposable PostgreSQL ONLY. The fixture DROPS auth/public schemas.
// Never use live or BetterQA QA in TEST_DATABASE_URL.
import { before, beforeEach, after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const url = process.env.TEST_DATABASE_URL;
const HOST = "00000000-0000-4000-8000-000000000ab1";
const RENTER = "00000000-0000-4000-8000-000000000ab2";
const UNUSED = "00000000-0000-4000-8000-000000000ab3";
const source = path => readFile(new URL(path, import.meta.url), "utf8");

describe("account deletion retains paid history — disposable PostgreSQL", {
  skip: !url, concurrency: 1,
}, () => {
  let pool, listingId, bookingId;
  before(async () => {
    pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000, max: 2 });
    await pool.query(await source("./booking-holds-fixture.sql"));
    await pool.query(await source("../../supabase-migration-005-booking-holds.sql"));
    await pool.query(await source("../../supabase-migration-010-preserve-bookings-on-listing-delete.sql"));
    await pool.query(await source("../../docs/sql-proposals/qa-account-deletion-booking-retention.sql"));
  });
  after(async () => { await pool?.end(); });

  beforeEach(async () => {
    await pool.query("truncate public.booking_holds,public.bookings,public.listings,public.profiles,auth.users restart identity cascade");
    await pool.query("insert into auth.users(id) values($1),($2),($3)", [HOST, RENTER, UNUSED]);
    await pool.query("insert into public.profiles(id) values($1),($2),($3)", [HOST, RENTER, UNUSED]);
    listingId = (await pool.query("insert into public.listings(host_id,spaces) values($1,1) returning id", [HOST])).rows[0].id;
    bookingId = (await pool.query(
      "insert into public.bookings(listing_id,renter_id,hours,status,paid_at,session_range) values($1,$2,1,'refunded',now(),tstzrange(now()-interval '2 days',now()-interval '2 days'+interval '1 hour','[)')) returning id",
      [listingId, RENTER],
    )).rows[0].id;
  });

  async function assertPreserved() {
    assert.equal((await pool.query("select count(*)::int as n from public.bookings where id=$1", [bookingId])).rows[0].n, 1);
    assert.equal((await pool.query("select count(*)::int as n from public.listings where id=$1", [listingId])).rows[0].n, 1);
    assert.equal((await pool.query("select count(*)::int as n from public.profiles where id=$1", [RENTER])).rows[0].n, 1);
  }

  test("Driver profile cannot silently delete refunded financial booking", async () => {
    await assert.rejects(pool.query("delete from public.profiles where id=$1", [RENTER]),
      e => e.code === "23503" && e.constraint === "bookings_renter_id_fkey");
    await assertPreserved();
  });

  test("deleting Driver auth.users cannot erase booking via profile cascade", async () => {
    await assert.rejects(pool.query("delete from auth.users where id=$1", [RENTER]),
      e => e.code === "23503");
    await assertPreserved();
    assert.equal((await pool.query("select count(*)::int as n from auth.users where id=$1", [RENTER])).rows[0].n, 1);
  });

  test("Host profile cannot cascade into listing and booking history", async () => {
    await assert.rejects(pool.query("delete from public.profiles where id=$1", [HOST]),
      e => e.code === "23503" && e.constraint === "listings_host_id_fkey");
    await assertPreserved();
  });

  test("Host auth deletion also fails closed and preserves all records", async () => {
    await assert.rejects(pool.query("delete from auth.users where id=$1", [HOST]),
      e => e.code === "23503");
    await assertPreserved();
    assert.equal((await pool.query("select count(*)::int as n from auth.users where id=$1", [HOST])).rows[0].n, 1);
  });

  test("unreferenced user deletion still works", async () => {
    const z = await pool.query("delete from auth.users where id=$1", [UNUSED]);
    assert.equal(z.rowCount, 1);
    assert.equal((await pool.query("select count(*)::int as n from public.profiles where id=$1", [UNUSED])).rows[0].n, 0);
    await assertPreserved();
  });

  test("an unused listing also blocks silent Host deletion until archival review", async () => {
    await pool.query("insert into public.listings(host_id,spaces) values($1,1)", [UNUSED]);
    await assert.rejects(pool.query("delete from public.profiles where id=$1", [UNUSED]),
      e => e.code === "23503" && e.constraint === "listings_host_id_fkey");
    await assertPreserved();
  });

  test("both installed account-facing FKs use RESTRICT", async () => {
    const { rows } = await pool.query(
      "select conname,confdeltype from pg_constraint where conname in ('bookings_renter_id_fkey','listings_host_id_fkey') order by conname");
    assert.deepEqual(rows, [
      { conname: "bookings_renter_id_fkey", confdeltype: "r" },
      { conname: "listings_host_id_fkey", confdeltype: "r" },
    ]);
  });
});
