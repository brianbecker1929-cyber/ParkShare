import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("rate-limit SQL is review-only and keeps existing booking/Stripe evidence", async () => {
  const sql=await readFile(new URL("../docs/sql-proposals/bug-005118-unpaid-hold-rate-limits.sql", import.meta.url),"utf8");
  assert.match(sql, /create table if not exists public\.booking_hold_attempts/);
  assert.match(sql, /alter table public\.booking_hold_attempts enable row level security/);
  assert.match(sql, /revoke all on public\.booking_hold_attempts from public, anon, authenticated/);
  assert.match(sql, /pg_advisory_xact_lock\(5118, hashtext\(p_renter_id::text\)\)/);
  assert.match(sql, /pg_advisory_xact_lock\(p_listing_id\)/);
  assert.match(sql, /h\.expires_at > now\(\)/);
  assert.match(sql, /a\.created_at > now\(\) - interval '2 hours'/);
  assert.match(sql, /a\.created_at > now\(\) - interval '24 hours'/);
  assert.match(sql, /errcode = 'P0058'/);
  assert.match(sql, /insert into public\.booking_hold_attempts \(renter_id, hold_id\)/);
  assert.match(sql, /expires_at <= now\(\) - interval '7 days'/);
  assert.doesNotMatch(sql, /delete from public\.bookings/);
  assert.doesNotMatch(sql, /delete from public\.booking_hold_attempts/);
  assert.doesNotMatch(sql, /stripe\.refunds/);
});

test("checkout responds 429 before any Stripe Session is created on limit errors", async () => {
  const code=await readFile(new URL("../api/create-checkout-session.js", import.meta.url),"utf8");
  assert.match(code, /if \(holdError\.code === "P0058"\)/);
  assert.match(code, /res\.status\(429\)/);
  assert.match(code, /checkout_rate_limited/);
  const tooMany=code.indexOf('if (holdError.code === "P0058")');
  const stripe=code.indexOf("stripe.checkout.sessions.create");
  assert.ok(tooMany>-1 && tooMany<stripe);
  assert.match(code, /if \(holdError\.code === "P0001"\)/);
  assert.match(code, /await supabaseAdmin\.rpc\("create_booking_hold"/);
});
