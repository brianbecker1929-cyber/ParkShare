// Disposable PostgreSQL only. Fixture resets public/auth schemas.
// NEVER point TEST_DATABASE_URL to BetterQA active QA or production.
import assert from "node:assert/strict";
import { before, beforeEach, after, describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";
const { Pool }=pg;
const db=process.env.TEST_DATABASE_URL;
const HOST="00000000-0000-4000-8000-000000000f01";
const RENTER="00000000-0000-4000-8000-000000000f02";
const read=path=>readFile(new URL(path,import.meta.url),"utf8");

describe("refund/dispute account-scoped booking writes (disposable PostgreSQL)", {skip:!db,concurrency:1},()=>{
  let pool, targetId, unrelatedId;
  before(async()=>{
    pool=new Pool({connectionString:db,connectionTimeoutMillis:5000,max:2});
    await pool.query(await read("./booking-holds-fixture.sql"));
  });
  after(async()=>{await pool?.end()});
  beforeEach(async()=>{
    await pool.query("truncate public.bookings,public.listings,public.profiles,auth.users restart identity cascade");
    await pool.query("insert into auth.users(id) values($1),($2)",[HOST,RENTER]);
    await pool.query("insert into public.profiles(id) values($1),($2)",[HOST,RENTER]);
    const listing=(await pool.query("insert into public.listings(host_id,spaces) values($1,2) returning id",[HOST])).rows[0].id;
    const rows=await pool.query("insert into public.bookings(listing_id,renter_id,status,paid_at,session_range,stripe_connected_account_id,stripe_payment_intent_id,stripe_charge_id) values ($1,$2,'confirmed',now(),tstzrange(now(),now()+interval '1 hour','[)'),'acct_owner','pi_same','ch_same'),($1,$2,'confirmed',now(),tstzrange(now()+interval '2 hours',now()+interval '3 hours','[)'),'acct_other','pi_same','ch_same') returning id",[listing,RENTER]);
    [targetId,unrelatedId]=rows.rows.map(x=>x.id);
  });
  async function statuses(){return (await pool.query("select id,status,refund_status,stripe_refund_id from public.bookings order by id")).rows}
  test("a refund event modifies only the booking on matching Host connected account",async()=>{
    const result=await pool.query("update public.bookings set status='refunded' where stripe_payment_intent_id='pi_same' and stripe_connected_account_id='acct_owner' and status not in ('refunded','disputed') returning id");
    assert.deepEqual(result.rows.map(x=>x.id),[targetId]);
    const [owner,other]=await statuses();
    assert.equal(owner.status,"refunded");
    assert.equal(other.status,"confirmed");
  });
  test("a dispute event modifies only the account that owns the Charge",async()=>{
    const result=await pool.query("update public.bookings set status='disputed' where stripe_charge_id='ch_same' and stripe_connected_account_id='acct_other' and status not in ('refunded') returning id");
    assert.deepEqual(result.rows.map(x=>x.id),[unrelatedId]);
    const [owner,other]=await statuses();
    assert.equal(owner.status,"confirmed");assert.equal(other.status,"disputed");
  });
  test("a stale partial-refund webhook cannot downgrade fully refunded booking",async()=>{
    await pool.query("update public.bookings set status='refunded' where id=$1",[targetId]);
    const update=await pool.query("update public.bookings set status='partially_refunded' where stripe_payment_intent_id='pi_same' and stripe_connected_account_id='acct_owner' and status not in ('refunded','disputed') returning id");
    assert.equal(update.rowCount,0);
    assert.equal((await statuses())[0].status,"refunded");
  });
  test("a refund event cannot overwrite another recorded refund ID",async()=>{
    await pool.query("update public.bookings set stripe_refund_id='re_first',refund_status='succeeded' where id=$1",[targetId]);
    const mismatch=await pool.query("update public.bookings set stripe_refund_id='re_second',refund_status='failed' where stripe_payment_intent_id='pi_same' and stripe_connected_account_id='acct_owner' and stripe_refund_id='re_second' returning id");
    assert.equal(mismatch.rowCount,0);
    const [owner]=await statuses();
    assert.equal(owner.stripe_refund_id,"re_first");
    assert.equal(owner.refund_status,"succeeded");
  });
  test("a duplicate refund webhook with same ID is idempotent",async()=>{
    const query="update public.bookings set stripe_refund_id='re_ok',refund_status='succeeded',refund_amount=10 where stripe_payment_intent_id='pi_same' and stripe_connected_account_id='acct_owner' and stripe_refund_id='re_ok' returning id";
    await pool.query("update public.bookings set stripe_refund_id='re_ok' where id=$1",[targetId]);
    const first=await pool.query(query);
    const again=await pool.query(query);
    assert.equal(first.rowCount,1);assert.equal(again.rowCount,1);
    const [owner,other]=await statuses();
    assert.equal(owner.refund_status,"succeeded");
    assert.equal(other.refund_status,null);
  });
});
