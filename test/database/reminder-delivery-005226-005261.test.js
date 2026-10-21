import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
test('reminder migration: private payloads, immutable unique delivery and atomic lease', { skip:!url }, async()=>{
  const pool = new pg.Pool({connectionString:url,max:4});
  try {
    await pool.query(await readFile(new URL('./booking-holds-fixture.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../../supabase/migrations/20261021103527_booking_reminder_delivery_005226_005261.sql',import.meta.url),'utf8'));
    await pool.query(`insert into auth.users values ('00000000-0000-4000-8000-000000000001');
      insert into public.profiles values ('00000000-0000-4000-8000-000000000001');
      insert into public.listings(host_id) values ('00000000-0000-4000-8000-000000000001');
      insert into public.bookings(listing_id,hours,status) values (1,1,'confirmed');`);
    await pool.query(`insert into public.booking_reminder_deliveries(id,booking_id,kind,session_ends_at,payload)
      values ('booking-1-halfway',1,'halfway',now()+interval '30 minutes','{"to":["synthetic@example.invalid"],"html":"original"}');`);
    const lease = () => pool.query(`update public.booking_reminder_deliveries
      set lease_until=now()+interval '2 minutes'
      where id='booking-1-halfway' and sent_at is null and lease_until<=now() returning id`);
    const claims = await Promise.all([lease(),lease(),lease()]);
    assert.equal(claims.reduce((n,r)=>n+r.rowCount,0),1,'only one concurrent worker claims delivery');
    await assert.rejects(pool.query(`insert into public.booking_reminder_deliveries(id,booking_id,kind,session_ends_at,payload)
      values ('other-id',1,'halfway',now(),'{}');`),{code:'23505'});
    const rights = await pool.query(`select relrowsecurity as rls,
      has_table_privilege('anon','public.booking_reminder_deliveries','select') as anon_read,
      has_table_privilege('authenticated','public.booking_reminder_deliveries','select') as auth_read,
      has_table_privilege('service_role','public.booking_reminder_deliveries','update') as worker_write
      from pg_class where oid='public.booking_reminder_deliveries'::regclass`);
    assert.deepEqual(rights.rows[0],{rls:true,anon_read:false,auth_read:false,worker_write:true});
    await pool.query(`update public.booking_reminder_deliveries set lease_until=now()-interval '1 second'`);
    assert.equal((await lease()).rowCount,1,'expired crash lease becomes retryable');
    await pool.query(`update public.booking_reminder_deliveries set sent_at=now(),provider_id='email-accepted',lease_until=now()-interval '1 second'`);
    assert.equal((await lease()).rowCount,0,'accepted delivery cannot be claimed again');
  } finally { await pool.end(); }
});
