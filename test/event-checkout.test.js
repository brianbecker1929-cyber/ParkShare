import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const checkout = readFileSync(new URL("../api/create-checkout-session.js", import.meta.url), "utf8");
const webhook = readFileSync(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase-migration-008-events.sql", import.meta.url), "utf8");

test("checkout validates an event against ParkShare data instead of trusting browser details", () => {
  assert.match(checkout, /const eventId =/);
  assert.match(checkout, /from\("events"\)/);
  assert.match(checkout, /eq\("status", "published"\)/);
  assert.match(checkout, /event_id: String\(bookingEvent\.id\)/);
  assert.doesNotMatch(checkout, /req\.body\?\.eventName/);
});

test("paid event parking saves a durable event snapshot for Driver and Host", () => {
  assert.match(webhook, /event_name: metadata\.event_name/);
  assert.match(webhook, /event_starts_at: metadata\.event_starts_at/);
  assert.match(webhook, /event_closure_notice: metadata\.event_closure_notice/);
  assert.match(migration, /create table if not exists public\.events/);
  assert.match(migration, /Published events are publicly readable/);
  assert.match(migration, /create table if not exists public\.event_listing_access/);
  assert.match(migration, /access_status in \('available', 'warning', 'blocked'\)/);
  assert.match(migration, /alter table public\.bookings add column if not exists event_id/);
});
