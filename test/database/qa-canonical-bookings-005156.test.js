import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import pg from "pg";

const { Pool } = pg;
const db = process.env.TEST_DATABASE_URL;
const HOST="00000000-0000-4000-8000-000000000301";
const DRIVER="00000000-0000-4000-8000-000000000302";

describe("BUG-005156 canonical booking SQL on disposable Postgres",{skip:!db,concurrency:1},()=>{
  let pool, listing, legacyId;
  before(async()=>{
    pool=new Pool({connectionString:db,connectionTimeoutMillis:5000,max:3});
    await pool.query(await readFile(new URL("./booking-holds-fixture.sql",import.meta.url),"utf8"));
    await pool.query([
      "ALTER TABLE public.bookings ADD COLUMN booking_date text;",
      "ALTER TABLE public.bookings ADD COLUMN start_hour numeric;",
      "INSERT INTO auth.users(id) VALUES ('"+HOST+"'),('"+DRIVER+"');",
      "INSERT INTO public.profiles(id) VALUES ('"+HOST+"'),('"+DRIVER+"');"
    ].join("\n"));
    const l=await pool.query("INSERT INTO public.listings(host_id,spaces) VALUES ($1,2) RETURNING id",[HOST]);
    listing=l.rows[0].id;
    const legacy=await pool.query(
      "INSERT INTO public.bookings(listing_id,renter_id,hours,status,paid_at,booking_date,start_hour,session_range) "+
      "VALUES($1,$2,2,'confirmed','2026-10-17T12:00:00Z','2026-10-20',14,"+
      "tstzrange('2026-10-20T14:00:00Z','2026-10-20T16:00:00Z','[)')) RETURNING id",
      [listing,DRIVER]);
    legacyId=legacy.rows[0].id;
    await pool.query(await readFile(new URL("../../docs/sql-proposals/bug-005156-property-local-canonical-bookings.sql",import.meta.url),"utf8"));
    // Production already has this trigger; the minimal CI fixture does not.
    await pool.query("CREATE TRIGGER bookings_session_range_trigger BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.bookings_compute_session_range()");
 
  });
  after(async()=>{await pool?.end()});

  test("old paid reservation still has exact same UTC session interval",async()=>{
    const r=await pool.query("SELECT lower(session_range) AS start,upper(session_range) AS finish,scheduled_starts_at FROM public.bookings WHERE id=$1",[legacyId]);
    assert.equal(new Date(r.rows[0].start).toISOString(),"2026-10-20T14:00:00.000Z");
    assert.equal(new Date(r.rows[0].finish).toISOString(),"2026-10-20T16:00:00.000Z");
    assert.equal(r.rows[0].scheduled_starts_at,null);
  });

  test("new Toronto reservation stores canonical property-local interval",async()=>{
    const r=await pool.query(
      "INSERT INTO public.bookings(listing_id,renter_id,hours,status,paid_at,booking_date,start_hour,session_range,scheduled_starts_at,property_time_zone) "+
      "VALUES($1,$2,2,'confirmed','2026-10-17T12:00:00Z','2026-10-20',14,"+
      "tstzrange('2026-10-20T14:00:00Z','2026-10-20T16:00:00Z','[)'),"+
      "'2026-10-20T18:00:00Z','America/Toronto') RETURNING lower(session_range) AS start,upper(session_range) AS finish",
      [listing,DRIVER]);
    assert.equal(new Date(r.rows[0].start).toISOString(),"2026-10-20T18:00:00.000Z");
    assert.equal(new Date(r.rows[0].finish).toISOString(),"2026-10-20T20:00:00.000Z");
  });

  test("untrusted half-populated canonical reservations are rejected",async()=>{
    await assert.rejects(pool.query(
      "INSERT INTO public.bookings(listing_id,renter_id,hours,status,paid_at,booking_date,start_hour,session_range,scheduled_starts_at) "+
      "VALUES($1,$2,2,'confirmed','2026-10-17T12:00:00Z','2026-10-20',14,"+
      "tstzrange('2026-10-20T14:00:00Z','2026-10-20T16:00:00Z','[)'),"+
      "'2026-10-20T18:00:00Z')",[listing,DRIVER]),err=>err.code==="22023"||err.code==="23514");
  });

  test("legacy row trigger re-evaluation keeps its previously defined UTC interpretation",async()=>{
    await pool.query("UPDATE public.bookings SET total=total+0 WHERE id=$1",[legacyId]);
    const r=await pool.query("SELECT lower(session_range) AS start FROM public.bookings WHERE id=$1",[legacyId]);
    assert.equal(new Date(r.rows[0].start).toISOString(),"2026-10-20T14:00:00.000Z");
  });
});
