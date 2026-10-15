import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const fixture = new URL("./booking-holds-fixture.sql", import.meta.url);
const migration = new URL("../../supabase-migration-012-host-role-listings-rls.sql", import.meta.url);
const HOST = "00000000-0000-4000-8000-000000000151";
const DRIVER = "00000000-0000-4000-8000-000000000152";
const OTHER = "00000000-0000-4000-8000-000000000153";

describe("BetterQA BUG-005142 Host-only listing writes", { skip: !databaseUrl, concurrency: 1 }, () => {
  let pool;

  before(async () => {
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 3 });
    await pool.query(await readFile(fixture, "utf8"));
    await pool.query(`
      alter table public.profiles add column role text not null default 'driver';
      update public.profiles set role = 'driver';
      create or replace function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated;
      grant select on public.profiles to authenticated;
      grant select, insert, update, delete on public.listings to authenticated;
      alter table public.profiles enable row level security;
      create policy "Profiles are viewable by everyone" on public.profiles for select using (true);
      alter table public.listings enable row level security;
      create policy "Hosts can insert their own listings" on public.listings
        for insert with check (auth.uid() = host_id);
      create policy "Hosts can update their own listings" on public.listings
        for update using (auth.uid() = host_id);
      create policy "Hosts can delete their own listings" on public.listings
        for delete using (auth.uid() = host_id);
    `);
    await pool.query(await readFile(migration, "utf8"));
  });

  beforeEach(async () => {
    await pool.query("truncate public.bookings, public.listings, public.profiles, auth.users restart identity cascade");
    await pool.query("insert into auth.users(id) values ($1),($2),($3)", [HOST, DRIVER, OTHER]);
    await pool.query("insert into public.profiles(id,role) values ($1,'host'),($2,'driver'),($3,'host')",
      [HOST, DRIVER, OTHER]);
  });

  after(async () => { await pool?.end(); });

  async function asUser(userId, sql, params = []) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
      const result = await client.query(sql, params);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  test("Drivers cannot create their own listing through direct REST-equivalent INSERT", async () => {
    await assert.rejects(
      asUser(DRIVER, "insert into public.listings(host_id,spaces) values ($1,1)", [DRIVER]),
      error => error.code === "42501"
    );
    const result = await pool.query("select count(*)::integer as n from public.listings");
    assert.equal(result.rows[0].n, 0);
  });

  test("Hosts can create and manage only their own listings", async () => {
    const created = await asUser(HOST, "insert into public.listings(host_id,spaces) values ($1,1) returning id", [HOST]);
    const id = created.rows[0].id;
    const updated = await asUser(HOST, "update public.listings set spaces=2 where id=$1 returning spaces", [id]);
    assert.equal(updated.rows[0].spaces, 2);
    await assert.rejects(
      asUser(HOST, "insert into public.listings(host_id,spaces) values ($1,1)", [OTHER]),
      error => error.code === "42501"
    );
    const removed = await asUser(HOST, "delete from public.listings where id=$1", [id]);
    assert.equal(removed.rowCount, 1);
  });

  test("A demoted Host cannot modify or delete prior listings", async () => {
    const created = await asUser(HOST, "insert into public.listings(host_id,spaces) values ($1,1) returning id", [HOST]);
    const id = created.rows[0].id;
    await pool.query("update public.profiles set role='driver' where id=$1", [HOST]);
    const updated = await asUser(HOST, "update public.listings set spaces=3 where id=$1", [id]);
    assert.equal(updated.rowCount, 0);
    const removed = await asUser(HOST, "delete from public.listings where id=$1", [id]);
    assert.equal(removed.rowCount, 0);
    const preserved = await pool.query("select spaces from public.listings where id=$1", [id]);
    assert.equal(preserved.rows[0].spaces, 1);
  });
});
