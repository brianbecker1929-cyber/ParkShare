import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("review-only atomic extension function uses Driver -> listing lock order to match quota RPC", async () => {
  const sql=await readFile(new URL("../docs/sql-proposals/qa-atomic-extensions-and-refunds.sql",import.meta.url),"utf8");
  const begin=sql.indexOf("CREATE OR REPLACE FUNCTION public.reserve_extension_checkout_hold");
  const end=sql.indexOf("$reserve$;",begin);
  assert.ok(begin>=0&&end>begin);
  const fn=sql.slice(begin,end);
  const driver=fn.indexOf("PERFORM pg_catalog.pg_advisory_xact_lock(5118, hashtext(p_renter_id::text))");
  const listing=fn.indexOf("PERFORM pg_catalog.pg_advisory_xact_lock(v_listing_id)");
  const nested=fn.indexOf("RETURN QUERY SELECT public.create_booking_hold(");
  assert.ok(driver>=0 && listing>driver && nested>listing);
  assert.match(fn,/IF p_booking_id IS NULL OR p_renter_id IS NULL/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.reserve_extension_checkout_hold[\s\S]*?TO service_role/);
});

test("existing paid extension apply RPC continues to lock by listing and never takes new quota locks",async()=>{
  const sql=await readFile(new URL("../docs/sql-proposals/qa-atomic-extensions-and-refunds.sql",import.meta.url),"utf8");
  const apply=sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.apply_paid_booking_extension"));
  assert.match(apply,/pg_advisory_xact_lock\(v_listing_id\)/);
  assert.doesNotMatch(apply,/pg_advisory_xact_lock\(5118/);
});

test("extension checkout returns a rate-limit 429 before creating Stripe session when quota RPC denies Driver",async()=>{
  const code=await readFile(new URL("../api/create-extend-session.js",import.meta.url),"utf8");
  const quota=code.indexOf('if (holdError?.code === "P0058")');
  const checkout=code.indexOf("stripe.checkout.sessions.create(");
  assert.ok(quota>0&&quota<checkout);
  assert.match(code,/res\.status\(429\)\.json/);
});
