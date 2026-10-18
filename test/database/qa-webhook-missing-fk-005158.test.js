// Disposable CI PostgreSQL only. Fixture DROPS public/auth schemas.
// Never point TEST_DATABASE_URL at ParkShare QA or production.
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PaidCheckoutReferenceError, translatePaidBookingInsertError } from "../../api/_paid-checkout-reference.js";

const { Pool } = pg;
const url = process.env.TEST_DATABASE_URL;
const HOST = "00000000-0000-4000-8000-000000000158";
const RENTER = "00000000-0000-4000-8000-000000000159";

describe("BUG-005158 missing paid checkout FK (disposable Postgres)", { skip: !url }, () => {
  let pool, listingId;
  const insert = (listing, renter, checkout) => pool.query(
    "insert into public.bookings(listing_id,renter_id,status,session_range,stripe_checkout_session_id) values($1,$2,'confirmed',tstzrange(now(),now()+interval '1 hour','[)'),$3) returning id",
    [listing, renter, checkout]
  );
  before(async () => {
    pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000, max: 4 });
    await pool.query(await readFile(new URL("./booking-holds-fixture.sql", import.meta.url), "utf8"));
    await pool.query("insert into auth.users(id) values($1),($2)", [HOST, RENTER]);
    await pool.query("insert into public.profiles(id) values($1),($2)", [HOST, RENTER]);
    listingId = (await pool.query("insert into public.listings(host_id,spaces) values($1,1) returning id",[HOST])).rows[0].id;
  });
  after(async () => { await pool?.end(); });

  test("normal paid booking with existing parents is inserted exactly once", async () => {
    const row = await insert(listingId, RENTER, "cs_test_005158_good");
    assert.equal(row.rowCount,1);
    const count = await pool.query("select count(*)::integer as n from public.bookings where stripe_checkout_session_id='cs_test_005158_good'");
    assert.equal(count.rows[0].n,1);
  });

  test("missing listing produces FK 23503 with no booking and never authorizes refund", async () => {
    await assert.rejects(
      insert(999999999, RENTER, "cs_test_005158_no_listing"),
      error => {
        assert.equal(error.code, "23503");
        assert.equal(error.constraint, "bookings_listing_id_fkey");
        const translated = translatePaidBookingInsertError(error);
        assert.equal(translated instanceof PaidCheckoutReferenceError,true);
        assert.equal(translated.code,"23503");
        return true;
      }
    );
    const r = await pool.query("select count(*)::integer as n from public.bookings where stripe_checkout_session_id='cs_test_005158_no_listing'");
    assert.equal(r.rows[0].n,0);
  });

  test("missing Driver produces FK 23503 with no confirmed booking", async () => {
    const unknown = "00000000-0000-4000-8000-000000000001";
    await assert.rejects(
      insert(listingId, unknown, "cs_test_005158_no_renter"),
      error => {
        assert.equal(error.code, "23503");
        assert.equal(error.constraint, "bookings_renter_id_fkey");
        assert.equal(translatePaidBookingInsertError(error) instanceof PaidCheckoutReferenceError,true);
        return true;
      }
    );
    const r = await pool.query("select count(*)::integer as n from public.bookings where stripe_checkout_session_id='cs_test_005158_no_renter'");
    assert.equal(r.rows[0].n,0);
  });
});
