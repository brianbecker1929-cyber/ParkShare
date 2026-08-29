import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, test } from "node:test";

import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.TEST_DATABASE_URL;
const fixtureUrl = new URL("./booking-holds-fixture.sql", import.meta.url);
const migrationUrl = new URL("../../supabase-migration-005-booking-holds.sql", import.meta.url);

const HOST_ID = "00000000-0000-4000-8000-000000000001";
const RENTER_ONE_ID = "00000000-0000-4000-8000-000000000002";
const RENTER_TWO_ID = "00000000-0000-4000-8000-000000000003";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForAdvisoryLockWait(pool, backendPid, timeoutMilliseconds = 5_000) {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `select wait_event_type, wait_event
         from pg_stat_activity
        where pid = $1`,
      [backendPid]
    );

    if (rows[0]?.wait_event_type === "Lock" && rows[0]?.wait_event === "advisory") {
      return;
    }

    await delay(25);
  }

  throw new Error(`Connection ${backendPid} did not wait on the booking advisory lock`);
}

describe("create_booking_hold database concurrency", { skip: !databaseUrl, concurrency: 1 }, () => {
  let pool;
  let listingId;

  before(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 6 });
    const [fixtureSql, migrationSql] = await Promise.all([
      readFile(fixtureUrl, "utf8"),
      readFile(migrationUrl, "utf8"),
    ]);

    await pool.query(fixtureSql);
    await pool.query(migrationSql);
  });

  beforeEach(async () => {
    await pool.query(
      `truncate table public.booking_holds, public.bookings, public.listings,
         public.profiles, auth.users restart identity cascade`
    );

    await pool.query(
      `insert into auth.users (id) values ($1), ($2), ($3)`,
      [HOST_ID, RENTER_ONE_ID, RENTER_TWO_ID]
    );
    await pool.query(`insert into public.profiles (id) values ($1)`, [HOST_ID]);

    const { rows } = await pool.query(
      `insert into public.listings (host_id, spaces)
       values ($1, 1)
       returning id`,
      [HOST_ID]
    );
    listingId = rows[0].id;
  });

  after(async () => {
    await pool?.end();
  });

  async function runSerializedHolds({ capacity, firstSpot, secondSpot }) {
    await pool.query(`update public.listings set spaces = $1 where id = $2`, [capacity, listingId]);

    const firstClient = await pool.connect();
    const secondClient = await pool.connect();
    let firstCommitted = false;
    let secondFinished = false;

    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1_000);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1_000);

    const holdSql = `
      select public.create_booking_hold($1, $2, $3, $4, $5, $6) as hold_id
    `;

    try {
      await firstClient.query("begin");
      await secondClient.query("begin");

      const firstResult = await firstClient.query(holdSql, [
        listingId,
        RENTER_ONE_ID,
        firstSpot,
        startsAt,
        endsAt,
        expiresAt,
      ]);

      const { rows: pidRows } = await secondClient.query(`select pg_backend_pid() as pid`);
      const secondAttempt = secondClient
        .query(holdSql, [listingId, RENTER_TWO_ID, secondSpot, startsAt, endsAt, expiresAt])
        .then(
          (result) => ({ ok: true, result }),
          (error) => ({ ok: false, error })
        );

      await waitForAdvisoryLockWait(pool, pidRows[0].pid);
      await firstClient.query("commit");
      firstCommitted = true;

      const secondOutcome = await secondAttempt;
      if (secondOutcome.ok) {
        await secondClient.query("commit");
      } else {
        await secondClient.query("rollback");
      }
      secondFinished = true;

      return {
        firstHoldId: firstResult.rows[0].hold_id,
        secondOutcome,
      };
    } finally {
      if (!firstCommitted) await firstClient.query("rollback").catch(() => {});
      if (!secondFinished) await secondClient.query("rollback").catch(() => {});
      firstClient.release();
      secondClient.release();
    }
  }

  test("only one overlapping hold wins the last available space", async () => {
    const result = await runSerializedHolds({ capacity: 1, firstSpot: "A", secondSpot: "B" });

    assert.match(result.firstHoldId, /^[0-9a-f-]{36}$/i);
    assert.equal(result.secondOutcome.ok, false);
    assert.equal(result.secondOutcome.error.code, "P0001");
    assert.match(result.secondOutcome.error.message, /Booking window is full/);

    const { rows } = await pool.query(`select count(*)::integer as count from public.booking_holds`);
    assert.equal(rows[0].count, 1);
  });

  test("only one overlapping hold wins the same named spot", async () => {
    const result = await runSerializedHolds({ capacity: 2, firstSpot: "A", secondSpot: "a" });

    assert.equal(result.secondOutcome.ok, false);
    assert.equal(result.secondOutcome.error.code, "P0001");
    assert.match(result.secondOutcome.error.message, /Selected parking spot is held/);

    const { rows } = await pool.query(`select spot_label from public.booking_holds`);
    assert.deepEqual(rows, [{ spot_label: "A" }]);
  });

  test("different spots both succeed when listing capacity permits", async () => {
    const result = await runSerializedHolds({ capacity: 2, firstSpot: "A", secondSpot: "B" });

    assert.equal(result.secondOutcome.ok, true);
    assert.match(result.secondOutcome.result.rows[0].hold_id, /^[0-9a-f-]{36}$/i);

    const { rows } = await pool.query(
      `select spot_label from public.booking_holds order by spot_label`
    );
    assert.deepEqual(rows, [{ spot_label: "A" }, { spot_label: "B" }]);
  });
});
