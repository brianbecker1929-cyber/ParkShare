import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isTransientSupabaseError, isMissingSupabaseRow, retryTransientSupabaseRead } from "../api/_webhook-db-retry.js";

const timeout = { message: "Gateway Timeout", status: 504 };
const noDelay = async () => {};

test("classifies QA Supabase gateway 504/522, connection resets and network failures", () => {
  for (const error of [
    timeout,
    { message: "Failed to fetch", status: 522 },
    { message: "Gateway Timeout" },
    { message: "Connection timed out", code: "PGRST000" },
    { message: "read ECONNRESET", code: "ECONNRESET" },
    { message: "fetch failed" },
    { message: "<title>supabase.co | 522: Connection timed out</title>" },
  ]) assert.equal(isTransientSupabaseError(error), true, JSON.stringify(error));
});

test("does not mistake FK violations, invalid credentials, missing rows, SQL timeouts, or integrity failures for transient outages", () => {
  for (const error of [
    { code: "23503", message: "foreign key constraint" },
    { code: "23505", message: "duplicate booking" },
    { code: "42501", message: "permission denied" },
    { code: "PGRST116", message: "no row found", status: 406 },
    { code: "57014", message: "canceling statement due to statement timeout", status: 500 },
    new Error("Checkout account mismatch"),
    new Error("Amount is invalid"),
  ]) assert.equal(isTransientSupabaseError(error), false, JSON.stringify(error));
  assert.equal(isMissingSupabaseRow({ code: "PGRST116" }), true);
  assert.equal(isMissingSupabaseRow(timeout), false);
});

test("first checkout database read retries a transient response and succeeds", async () => {
  let attempts = 0, retries = 0;
  const result = await retryTransientSupabaseRead(async () =>
    ++attempts === 1 ? { data: null, error: timeout } : { data: { id: 12 }, error: null },
    { pause: noDelay, onRetry: () => { retries++; } }
  );
  assert.deepEqual(result, { data: { id: 12 }, error: null });
  assert.equal(attempts, 2);
  assert.equal(retries, 1);
});

test("thrown network errors retry only once and then propagate, leaving Stripe free to redeliver", async () => {
  let attempts = 0;
  await assert.rejects(
    retryTransientSupabaseRead(async () => {
      attempts++;
      throw Object.assign(new Error("connect reset"), { code: "ECONNRESET" });
    }, { pause: noDelay }),
    /connect reset/
  );
  assert.equal(attempts, 2);
});

test("persistent gateway error is returned after bounded retry, never acknowledged as success", async () => {
  let attempts = 0;
  const r = await retryTransientSupabaseRead(async () => {
    attempts++;
    return { data: null, error: timeout };
  }, { pause: noDelay });
  assert.equal(attempts, 2);
  assert.equal(r.error, timeout);
});

test("nontransient FK or missing parent error never retries", async () => {
  for (const error of [
    { code: "23503", message: "bookings_listing_id_fkey", status: 409 },
    { code: "PGRST116", message: "missing", status: 406 },
  ]) {
    let attempts = 0;
    const r = await retryTransientSupabaseRead(async () => { attempts++; return { data: null, error }; }, { pause: noDelay });
    assert.equal(attempts, 1);
    assert.equal(r.error, error);
  }
});

test("retry helper cannot loop without bound", async () => {
  await assert.rejects(retryTransientSupabaseRead(() => Promise.resolve({}), { maxAttempts: 0 }), RangeError);
  await assert.rejects(retryTransientSupabaseRead(() => Promise.resolve({}), { maxAttempts: 10 }), RangeError);
});

test("webhook uses retry on its READs and propagates transport errors instead of refunding", async () => {
  const source = await readFile(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
  const hostStart = source.indexOf("async function hostAccountForListing");
  const hostEnd = source.indexOf("async function validatedIntent", hostStart);
  const host = source.slice(hostStart, hostEnd);
  assert.match(host, /if \(listingError && !isMissingSupabaseRow\(listingError\)\) throw listingError;/);
  assert.match(host, /if \(hostError && !isMissingSupabaseRow\(hostError\)\) throw hostError;/);
  assert.match(host, /retryTransientSupabaseRead/);
  for (const label of [
    "booking_idempotency_lookup", "extension_idempotency_lookup",
    "registered_hold_lookup", "pending_extension_lookup", "host_account_lookup",
  ]) assert.ok(source.includes(label), label);
  const processor = source.slice(source.indexOf("async function processPaidCheckout"), source.indexOf("export default async function handler"));
  assert.match(processor, /if \(bookedError\) throw bookedError/);
  assert.match(processor, /if \(holdError\) throw holdError/);
  assert.match(processor, /if \(!\(error instanceof CheckoutIntegrityError\)\) throw error/);
  assert.match(source, /return res.status\(500\)\.json\(\{ error: "Webhook processing failed" \}\)/);
});
