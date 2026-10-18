// Disposable Postgres only. NEVER run against ParkShare-QA or production;
// the fixture intentionally resets public/auth test schemas.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, after, describe, test } from "node:test";
import pg from "pg";

const { Pool } = pg;
const url = process.env.TEST_DATABASE_URL;

describe("BUG-005137 database hourly rate constraint", { skip: !url, concurrency: 1 }, () => {
  let pool;
  const host = "00000000-0000-4000-8000-000000000137";

  before(async () => {
    pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000, max: 3 });
    await pool.query(await readFile(new URL("./booking-holds-fixture.sql", import.meta.url), "utf8"));
    // Stand-in for the real production numeric NOT NULL listings.price.
    await pool.query("alter table public.listings add column price numeric not null default 12");
    await pool.query("insert into auth.users(id) values ($1)", [host]);
    await pool.query("insert into public.profiles(id) values ($1)", [host]);
    const sql = await readFile(new URL("../../docs/sql-proposals/bug-005137-hourly-price-constraint.sql", import.meta.url), "utf8");
    await pool.query(sql);
    // Proposal is safe to re-run while checking idempotency in disposable DB.
    await pool.query(sql);
  });
  after(async () => { await pool?.end(); });

  const create = price => pool.query("insert into public.listings(host_id,spaces,price) values ($1,1,$2) returning id, price", [host, price]);

  test("accepts positive rates with whole cents and preserves legacy $900 listing", async () => {
    for (const value of ["1", "1.25", "12.99", "200", "900"]) {
      const r = await create(value);
      assert.equal(Number(r.rows[0].price), Number(value));
    }
  });

  test("blocks zero, negative and fractional-cent inserts at the database boundary", async () => {
    for (const bad of ["0", "-1", "-25", "0.99", "1.001", "12.999"]) {
      await assert.rejects(create(bad), error => error.code === "23514", bad);
    }
  });

  test("blocks direct edits that attempt to overwrite a valid Host rate", async () => {
    const { rows } = await create("12.5");
    const id = rows[0].id;
    await assert.rejects(
      pool.query("update public.listings set price=-8 where id=$1", [id]),
      error => error.code === "23514"
    );
    const verify = await pool.query("select price from public.listings where id=$1", [id]);
    assert.equal(Number(verify.rows[0].price), 12.5);
  });

  test("constraint can be independently validated on existing conforming rows", async () => {
    const p = await pool.query("select convalidated from pg_constraint where conname='listings_hourly_price_valid_005137'");
    assert.equal(p.rows.length, 1);
    await pool.query("alter table public.listings validate constraint listings_hourly_price_valid_005137");
    const post = await pool.query("select convalidated from pg_constraint where conname='listings_hourly_price_valid_005137'");
    assert.equal(post.rows[0].convalidated, true);
  });
});
