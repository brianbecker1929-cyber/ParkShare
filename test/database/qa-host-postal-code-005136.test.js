// Run only with TEST_DATABASE_URL pointing to disposable CI PostgreSQL.
// The fixture DROPS public/auth schemas. Never use a QA or production URL.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, after, describe, test } from "node:test";
import pg from "pg";
const { Pool } = pg;
const url = process.env.TEST_DATABASE_URL;
const HOST = "00000000-0000-4000-8000-000000000136";

describe("BUG-005136 proposed listing-address SQL safeguard (disposable PostgreSQL)", { skip: !url, concurrency: 1 }, () => {
  let pool, historicalId;
  before(async () => {
    pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000, max: 4 });
    await pool.query(await readFile(new URL("./booking-holds-fixture.sql", import.meta.url), "utf8"));
    await pool.query("alter table public.listings add column address text not null default '123 Main St, Toronto, ON M5V 2T6'");
    await pool.query("insert into auth.users(id) values ($1)", [HOST]);
    await pool.query("insert into public.profiles(id) values ($1)", [HOST]);
    const old = await pool.query("insert into public.listings(host_id,spaces,address) values($1,1,'Legacy address without postal code') returning id", [HOST]);
    historicalId = old.rows[0].id;
    const sql = await readFile(new URL("../../docs/sql-proposals/bug-005136-listing-postal-validation.sql", import.meta.url), "utf8");
    await pool.query(sql);
    await pool.query(sql); // proposal is idempotent
  });
  after(async () => { await pool?.end(); });

  const insert = address => pool.query("insert into public.listings(host_id,spaces,address) values($1,1,$2) returning id", [HOST, address]);

  test("accepts new formatted Canadian postal codes", async () => {
    for (const address of [
      "99 Main St, Vaughan, Ontario L4J 1A1",
      "100 Queen Street, Ottawa, Ontario K1A 0B1",
      "1000 Road, Whitehorse, Yukon Y1A 2B3",
    ]) {
      const q = await insert(address);
      assert.equal(q.rowCount, 1);
    }
  });

  test("blocks new invalid suffixes even if direct database insert bypasses the Host form", async () => {
    for (const invalid of [
      "Main Street, Toronto 12345",
      "Main Street, Toronto Z1A 1A1",
      "Main Street, Toronto L4J 1D1",
      "Main Street, Toronto L4J1A1",
      "Main Street, Toronto No postal code",
    ]) {
      await assert.rejects(insert(invalid), err => err.code === "23514", invalid);
    }
  });

  test("historical unformatted addresses can still change unrelated fields", async () => {
    await pool.query("update public.listings set spaces=2 where id=$1", [historicalId]);
    const r = await pool.query("select address,spaces from public.listings where id=$1", [historicalId]);
    assert.equal(r.rows[0].spaces, 2);
    assert.equal(r.rows[0].address, "Legacy address without postal code");
  });

  test("historical address edits require a valid suffix, but can be corrected", async () => {
    await assert.rejects(
      pool.query("update public.listings set address='Invalid new address' where id=$1", [historicalId]),
      err => err.code === "23514"
    );
    await pool.query("update public.listings set address='Corrected, Ottawa, Ontario K1A 0B1' where id=$1", [historicalId]);
    const r = await pool.query("select address from public.listings where id=$1", [historicalId]);
    assert.match(r.rows[0].address, /K1A 0B1$/);
  });

  test("Host-facing trigger function is not directly executable by anonymous/authenticated roles", async () => {
    const q = await pool.query("select has_function_privilege('anon', 'public.enforce_listing_postal_format_005136()', 'EXECUTE') as anonymous, has_function_privilege('authenticated', 'public.enforce_listing_postal_format_005136()', 'EXECUTE') as member");
    assert.deepEqual(q.rows[0], { anonymous: false, member: false });
  });
});
