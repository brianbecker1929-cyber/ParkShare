import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {assertLocalRehearsalUrl} from '../../scripts/qa-schema-rehearsal.mjs';
import {runRefundNotificationsProbe} from '../../scripts/qa-refund-notifications-probe.mjs';
const url=process.env.TEST_DATABASE_URL;
test('refund receipts commit with ledger transitions and isolate both audiences',{skip:!url},async()=>{
  assertLocalRehearsalUrl(url);
  const client=new pg.Client({connectionString:url});await client.connect();
  try {
    await client.query(await readFile(new URL('./booking-holds-fixture.sql',import.meta.url),'utf8'));
    await client.query(`drop schema if exists parkshare_private cascade;
      alter table auth.users add column email text,add column raw_user_meta_data jsonb;
      alter table public.listings add column title text,add column address text,add column price numeric,add column lat numeric,add column lng numeric,add column time_zone text;
      create table public.booking_extensions(id bigint generated always as identity primary key,booking_id bigint references public.bookings(id),added_hours numeric,added_amount numeric not null,paid_at timestamptz,status text,stripe_charge_id text,stripe_payment_intent_id text,stripe_connected_account_id text,stripe_refund_id text,refund_amount numeric,refund_status text,refund_failure_reason text,refund_reconciled_at timestamptz,charge_amount_refunded numeric,charge_fully_refunded boolean,charge_disputed boolean not null default false);`);
    await client.query(await readFile(new URL('../../supabase/migrations/20261019182335_multiple_refund_ledger_005188.sql',import.meta.url),'utf8'));
    const report={checks:[],migrations:[]};
    await runRefundNotificationsProbe({query:(s,a)=>client.query(s,a),exec:s=>client.query(s)},report);
    assert.equal(report.checks.length,10);
  } finally {await client.end();}
});
