import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("review-only account retention SQL guards exactly Host and Driver profile-linked history", async () => {
  const sql = await readFile(new URL("../docs/sql-proposals/qa-account-deletion-booking-retention.sql", import.meta.url), "utf8");
  assert.match(sql, /REVIEW-ONLY database proposal/);
  assert.match(sql, /DO NOT EXECUTE on ParkShare-QA or production/);
  assert.match(sql, /BEGIN;[\s\S]*SET LOCAL lock_timeout = '5s'/);
  assert.match(sql, /ALTER TABLE public\.bookings[\s\S]*?DROP CONSTRAINT bookings_renter_id_fkey;[\s\S]*?ADD CONSTRAINT bookings_renter_id_fkey[\s\S]*?REFERENCES public\.profiles\(id\)[\s\S]*?ON DELETE RESTRICT;/);
  assert.match(sql, /ALTER TABLE public\.listings[\s\S]*?DROP CONSTRAINT listings_host_id_fkey;[\s\S]*?ADD CONSTRAINT listings_host_id_fkey[\s\S]*?REFERENCES public\.profiles\(id\)[\s\S]*?ON DELETE RESTRICT;/);
  assert.match(sql, /COMMIT;/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE;\s*\n\s*COMMIT/);
  assert.doesNotMatch(sql, /\bDELETE FROM\b/i);
});

test("existing listing retention migration remains separate, without unwanted production data changes", async () => {
  const sql = await readFile(new URL("../supabase-migration-010-preserve-bookings-on-listing-delete.sql", import.meta.url), "utf8");
  assert.match(sql, /bookings_listing_id_fkey/);
  assert.match(sql, /booking_holds_listing_id_fkey/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /bookings_renter_id_fkey|listings_host_id_fkey/);
});
