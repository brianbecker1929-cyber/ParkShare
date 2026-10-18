import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("BUG-005116 checkout reserves the additional interval before any Stripe session", async () => {
  const code = await source("../api/create-extend-session.js");
  assert.match(code, /supabaseAdmin\.rpc\("create_booking_hold"/);
  const reserve = code.indexOf('supabaseAdmin.rpc("create_booking_hold"');
  const stripeCreate = code.indexOf("stripe.checkout.sessions.create(");
  const bindHold = code.indexOf('update({ stripe_checkout_session_id: session.id })');
  const insertPending = code.indexOf('.from("pending_booking_extensions")\n        .insert(');
  const returnUrl = code.indexOf("res.status(200).json({ url: session.url })");
  assert.ok(reserve > 0 && reserve < stripeCreate && stripeCreate < bindHold);
  assert.ok(bindHold < insertPending && insertPending < returnUrl);
  assert.match(code, /p_starts_at: current\.end\.toISOString\(\)/);
  assert.match(code, /p_ends_at: extendedEnd\.toISOString\(\)/);
  assert.match(code, /p_spot_label: booking\.spot_label \|\| null/);
  assert.match(code, /p_renter_id: user\.id/);
  assert.match(code, /hold_id: holdId/);
  assert.match(code, /expires_at: Math\.floor\(holdExpiresAt\.getTime\(\) \/ 1000\)/);
});

test("BUG-005116 refuses full or held extension slot with a 409 before Stripe", async () => {
  const code = await source("../api/create-extend-session.js");
  assert.match(code, /if \(holdError\?\.code === "P0001"\)/);
  assert.ok(code.indexOf('if (holdError?.code === "P0001")') < code.indexOf("stripe.checkout.sessions.create"));
  assert.match(code, /res\.status\(409\)\.json\(\{ error: "That additional parking time is already booked or held/);
});

test("BUG-005116 checkout failures expire orphan Stripe checkout and release only its hold", async () => {
  const code = await source("../api/create-extend-session.js");
  assert.match(code, /catch \(checkoutError\)/);
  assert.match(code, /stripe\.checkout\.sessions\.expire\(session\.id/);
  assert.match(code, /pending_booking_extensions"\)\.delete\(\)/);
  assert.match(code, /booking_holds"\)\.delete\(\)/);
  assert.match(code, /\.eq\("id", holdId\)\s*\.eq\("listing_id", listing\.id\)\s*\.eq\("renter_id", user\.id\)/);
  assert.match(code, /throw checkoutError/);
});

test("BUG-005116 webhook RPC rejects unrelated holds, ignores own hold in capacity, releases on success", async () => {
  const sql = await source("../docs/sql-proposals/qa-atomic-extensions-and-refunds.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS hold_id uuid/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS pending_booking_extensions_hold_id_unique/);
  assert.match(sql, /IF p\.hold_id IS NULL THEN/);
  assert.match(sql, /h\.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id/);
  assert.match(sql, /h\.renter_id IS DISTINCT FROM p_renter_id/);
  assert.match(sql, /h\.starts_at IS DISTINCT FROM v_old_end/);
  assert.match(sql, /h\.ends_at IS DISTINCT FROM v_new_end/);
  assert.match(sql, /AND h\.id<>p\.hold_id/);
  const bookingUpdate = sql.indexOf("UPDATE public.bookings x SET hours=x.hours+p_added_hours");
  const release = sql.indexOf("DELETE FROM public.booking_holds x WHERE x.id=p.hold_id");
  assert.ok(bookingUpdate > 0 && release > bookingUpdate);
  assert.match(sql, /IF FOUND THEN[\s\S]*?RETURN QUERY SELECT false,b\.hours/);
});

test("BUG-005116 failure/expiry webhook continues to release registered session holds", async () => {
  const webhook = await source("../api/stripe-webhook.js");
  const start = webhook.indexOf('case "checkout.session.async_payment_failed":');
  assert.ok(start >= 0);
  const segment = webhook.slice(start, webhook.indexOf('case "account.updated":',start));
  assert.match(segment, /\.from\("booking_holds"\)\.delete\(\)\s*\.eq\("stripe_checkout_session_id", session\.id\)/);
  assert.match(segment, /\.from\("pending_booking_extensions"\)\.delete\(\)\s*\.eq\("stripe_checkout_session_id", session\.id\)/);
});
