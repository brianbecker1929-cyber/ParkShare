// Unified BetterQA migration rehearsal on disposable PostgreSQL ONLY.
// WARNING: booking-holds-fixture.sql DROPS public/auth schemas.
// Never point TEST_DATABASE_URL at a hosted Supabase, QA or production database.
// This deliberately models dependencies rather than cloning private QA data.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const HOST = "00000000-0000-4000-8000-00000000d181";
const DRIVER = "00000000-0000-4000-8000-00000000d182";
const OTHER = "00000000-0000-4000-8000-00000000d183";
const sql = relative => readFile(new URL(relative, import.meta.url), "utf8");
const proposals = [
  "../../docs/sql-proposals/bug-005118-unpaid-hold-rate-limits.sql",
  "../../docs/sql-proposals/qa-atomic-extensions-and-refunds.sql",
  "../../docs/sql-proposals/bug-005156-property-local-canonical-bookings.sql",
  "../../docs/sql-proposals/bug-005136-listing-postal-validation.sql",
  "../../docs/sql-proposals/bug-005137-hourly-price-constraint.sql",
  "../../docs/sql-proposals/bug-005138-future-exceptions.sql",
  "../../docs/sql-proposals/qa-verified-reviews.sql",
  "../../docs/sql-proposals/bug-005183-restrict-public-data-api.sql",
  "../../docs/sql-proposals/qa-account-deletion-booking-retention.sql",
];

// Fail BEFORE any DROP/DDL when a mistaken live/remote connection is supplied.
function assertDisposableUrl(raw) {
  const u = new URL(raw);
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname),
    "Migration rehearsal MUST run against local disposable PostgreSQL only");
  assert.equal(decodeURIComponent(u.pathname), "/parkshare_test",
    "Migration rehearsal requires dedicated database named parkshare_test");
}

describe("unified QA proposed SQL: ordered disposable-schema rehearsal", {
  skip: !databaseUrl,
  concurrency: 1,
}, () => {
  let pool, listingId, legacyId, original;

  before(async () => {
    assertDisposableUrl(databaseUrl);
    pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 3 });
    assert.equal((await pool.query("select current_database() name")).rows[0].name, "parkshare_test");
    // Bootstrap a fresh, LOCAL, production-shaped subset. No connected Supabase calls.
    for (const p of [
      "./booking-holds-fixture.sql",
      "../../supabase-migration-005-booking-holds.sql",
      "../../supabase-migration-010-preserve-bookings-on-listing-delete.sql",
      "../../supabase-migration-011-registered-checkouts.sql",
    ]) await pool.query(await sql(p));

    await pool.query([
      "ALTER TABLE public.listings ADD COLUMN address text NOT NULL DEFAULT '100 Test Lane, Toronto, ON M5V 2T6';",
      "ALTER TABLE public.listings ADD COLUMN price numeric NOT NULL DEFAULT 12.50;",
      "ALTER TABLE public.listings ADD COLUMN availability jsonb;",
      "ALTER TABLE public.listings ADD COLUMN lat double precision;",
      "ALTER TABLE public.listings ADD COLUMN lng double precision;",
      "ALTER TABLE public.profiles ADD COLUMN role text, ADD COLUMN name text;",
      "ALTER TABLE public.bookings ADD COLUMN booking_date text;",
      "ALTER TABLE public.bookings ADD COLUMN start_hour numeric;",
      "CREATE TABLE public.booking_extensions (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, booking_id bigint NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE, added_hours numeric NOT NULL, added_amount numeric NOT NULL, stripe_checkout_session_id text UNIQUE, stripe_payment_intent_id text, stripe_charge_id text, stripe_connected_account_id text, status text NOT NULL, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());",
      "CREATE TABLE public.reviews (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, listing_id bigint NOT NULL REFERENCES public.listings(id), user_id uuid NOT NULL REFERENCES public.profiles(id), rating integer NOT NULL, text text NOT NULL);",
      "DROP SCHEMA IF EXISTS storage CASCADE;",
      "CREATE SCHEMA storage;",
      "CREATE TABLE storage.buckets (id text PRIMARY KEY, public boolean NOT NULL);",
      "INSERT INTO storage.buckets VALUES ('listing-photos', true);",
      "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $authuid$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $authuid$;",
      "ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;",
      "ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;",
      "ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;",
      'CREATE POLICY "Listings are viewable by everyone" ON public.listings FOR SELECT USING(true);',
      'CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING(true);',
      'CREATE POLICY "Reviews are viewable by everyone" ON public.reviews FOR SELECT USING(true);',
      'CREATE POLICY "Authenticated users can leave reviews" ON public.reviews FOR INSERT TO authenticated WITH CHECK(auth.uid()=user_id);',
      "GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;",
      "GRANT SELECT ON public.listings,public.profiles,public.reviews TO anon,authenticated;",
      "GRANT INSERT ON public.reviews TO authenticated;",
      // The QA schema already has a booking range trigger. Replacing its function
      // must leave old intervals intact while enabling canonical intervals.
      "CREATE FUNCTION public.bookings_compute_session_range() RETURNS trigger LANGUAGE plpgsql AS $old$ BEGIN RETURN NEW; END $old$;",
      "CREATE TRIGGER bookings_session_range_trigger BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bookings_compute_session_range();",
    ].join("\n"));

    await pool.query("INSERT INTO auth.users(id) VALUES($1),($2),($3)", [HOST, DRIVER, OTHER]);
    await pool.query("INSERT INTO public.profiles(id,role) VALUES($1,'host'),($2,'driver'),($3,'driver')", [HOST, DRIVER, OTHER]);
    listingId = (await pool.query(
      "INSERT INTO public.listings(host_id,spaces,address,price,lat,lng) VALUES($1,2,'Legacy street address',900,43.7,-79.4) RETURNING id", [HOST],
    )).rows[0].id;
    legacyId = (await pool.query(
      "INSERT INTO public.bookings(listing_id,renter_id,status,spot_label,booking_date,start_hour,hours,paid_at,session_range) VALUES($1,$2,'confirmed','A','2026-10-20',14,2,'2026-10-17T12:00:00Z',tstzrange('2026-10-20T14:00Z','2026-10-20T16:00Z','[)')) RETURNING id", [listingId, DRIVER],
    )).rows[0].id;
    await pool.query("INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES($1,$2,5,'Existing verified review')", [listingId, DRIVER]);
    original = (await pool.query(
      "SELECT lower(session_range) AS begins,upper(session_range) AS ends,booking_date,start_hour,hours FROM public.bookings WHERE id=$1", [legacyId],
    )).rows[0];

    // The actual point of this test: all nine proposed SQL files installed
    // consecutively into ONE disposable schema, not nine isolated test DBs.
    for (const path of proposals) await pool.query(await sql(path));
  });

  after(async () => { await pool?.end(); });

  async function as(role, user, statement, args = []) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE " + role);
      if (user) await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
      try {
        const result = await client.query(statement, args);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    } finally { client.release(); }
  }

  test("all nine SQL proposals coexist with both baseline migrations", async () => {
    const names = [
      "booking_hold_attempts", "pending_booking_extensions", "booking_extensions",
      "reviews", "listings", "bookings",
    ];
    for (const name of names) {
      assert.equal((await pool.query("SELECT to_regclass($1) AS table_name", ["public." + name])).rows[0].table_name, name);
    }
    const rpc = await pool.query("SELECT to_regprocedure('public.reserve_extension_checkout_hold(bigint,uuid,numeric,timestamptz)') IS NOT NULL AS reserve, to_regprocedure('public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz)') IS NOT NULL AS apply");
    assert.deepEqual(rpc.rows[0], { reserve: true, apply: true });
  });

  test("existing paid scheduled booking remains byte-for-byte at original UTC interval", async () => {
    const updated = (await pool.query(
      "SELECT lower(session_range) AS begins,upper(session_range) AS ends,booking_date,start_hour,hours,scheduled_starts_at FROM public.bookings WHERE id=$1", [legacyId],
    )).rows[0];
    for (const field of ["begins", "ends", "booking_date", "start_hour", "hours"]) {
      assert.deepEqual(updated[field], original[field], field);
    }
    assert.equal(updated.scheduled_starts_at, null);
  });

  test("quota, extension and privacy permissions remain service-role scoped", async () => {
    const forbidden = ["public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)",
      "public.reserve_extension_checkout_hold(bigint,uuid,numeric,timestamptz)",
      "public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz)"];
    for (const rpc of forbidden) {
      const r = await pool.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') AS user_execute,has_function_privilege('anon',$1,'EXECUTE') AS anon_execute,has_function_privilege('service_role',$1,'EXECUTE') AS server_execute", [rpc]);
      assert.deepEqual(r.rows[0], { user_execute: false, anon_execute: false, server_execute: true }, rpc);
    }
    for (const table of ["listings", "profiles", "reviews"]) {
      await assert.rejects(as("anon", null, "SELECT * FROM public." + table), e => e.code === "42501");
    }
    assert.equal((await as("authenticated", OTHER, "SELECT id FROM public.listings")).rowCount, 0);
    assert.equal((await as("authenticated", HOST, "SELECT id FROM public.listings WHERE id=$1", [listingId])).rowCount, 1);
    assert.equal((await pool.query("SELECT public FROM storage.buckets WHERE id='listing-photos'")).rows[0].public, false);
  });

  test("historical Host listing remains intact, invalid new price/postal are rejected", async () => {
    const old = (await pool.query("SELECT address,price FROM public.listings WHERE id=$1", [listingId])).rows[0];
    assert.equal(old.address, "Legacy street address");
    assert.equal(Number(old.price), 900);
    await assert.rejects(pool.query(
      "INSERT INTO public.listings(host_id,address,price) VALUES($1,'Bad postal',12)", [HOST],
    ), e => e.code === "23514");
    await assert.rejects(pool.query(
      "INSERT INTO public.listings(host_id,address,price) VALUES($1,'100 Test Lane, Toronto, ON M5V 2T6',12.999)", [HOST],
    ), e => e.code === "23514");
  });

  test("new canonical Toronto booking uses property-local instant while legacy remains unchanged", async () => {
    const fresh = await pool.query(
      "INSERT INTO public.bookings(listing_id,renter_id,status,hours,booking_date,start_hour,paid_at,session_range,scheduled_starts_at,property_time_zone) VALUES($1,$2,'confirmed',1,'2026-10-21',14,'2026-10-18T12:00Z',tstzrange('2026-10-21T14:00Z','2026-10-21T15:00Z','[)'),'2026-10-21T18:00Z','America/Toronto') RETURNING lower(session_range) as begins", [listingId, OTHER],
    );
    assert.equal(new Date(fresh.rows[0].begins).toISOString(), "2026-10-21T18:00:00.000Z");
  });

  test("paid booking and listing references are RESTRICT, never cascade", async () => {
    const row = await pool.query(
      "SELECT conname,confdeltype FROM pg_constraint WHERE conname IN ('bookings_renter_id_fkey','listings_host_id_fkey','bookings_listing_id_fkey') ORDER BY conname",
    );
    assert.deepEqual(row.rows, [
      { conname: "bookings_listing_id_fkey", confdeltype: "r" },
      { conname: "bookings_renter_id_fkey", confdeltype: "r" },
      { conname: "listings_host_id_fkey", confdeltype: "r" },
    ]);
    await assert.rejects(pool.query("DELETE FROM auth.users WHERE id=$1", [DRIVER]), e => e.code === "23503");
  });
});
