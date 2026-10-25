// A production-shaped rehearsal on a NEW local PostgreSQL 17 service only.
// Contains no hosted connection, production rows, Stripe client or email sender.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {assertLocalRehearsalUrl} from './qa-schema-rehearsal.mjs';
import {runSchemaProbes} from './qa-schema-probes.mjs';
import {runPhotoCleanupProbe} from './qa-photo-cleanup-probe.mjs';
import {runRefundLedgerProbe} from './qa-refund-ledger-probe.mjs';
import {runPublicParkingProbe} from './qa-public-parking-probe.mjs';
import {runListingTimezoneProbe} from './qa-listing-timezone-probe.mjs';
import {runListingPublicationProbe} from './qa-listing-publication-probe.mjs';
import {runExtensionSettlementProbe} from './qa-extension-settlement-probe.mjs';
import {runRefundNotificationsProbe} from './qa-refund-notifications-probe.mjs';
import {runInitialBookingRefundProbe} from './qa-initial-booking-refund-probe.mjs';
import {runExtensionCapacityProbe} from './qa-extension-capacity-probe.mjs';

const raw=process.env.PRODUCTION_SCHEMA_REHEARSAL_DATABASE_URL;
assert.ok(raw,'Set PRODUCTION_SCHEMA_REHEARSAL_DATABASE_URL to a NEW LOCAL /parkshare_test');
assertLocalRehearsalUrl(raw); // Must run BEFORE any connection or reset.
const fixture=await readFile(new URL('../test/database/fixtures/production-schema-oct25.json',import.meta.url),'utf8');
const snapshot=JSON.parse(fixture);
const report={checks:[],migrations:[],sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  baseline:'production application/auth/storage catalog; no customer rows',capturedAt:snapshot.inventory.captured_at,
  fixtureSha256:createHash('sha256').update(fixture).digest('hex'),releaseApproved:false};
const client=new pg.Client({connectionString:raw,connectionTimeoutMillis:5000});
const check=async(name,fn)=>{await fn();report.checks.push({name,status:'passed'});};
const install=async(db,path)=>{await db.exec(await readFile(new URL('../'+path,import.meta.url),'utf8'));report.migrations.push({name:path,status:'passed'});};
try {
  await client.connect();
  assert.equal((await client.query('select current_database() db')).rows[0].db,'parkshare_test');
  const db={query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql)};
  await check('baseline records ten public tables, missing checkout registration and no listing-photo bucket',async()=>{
    assert.equal(snapshot.inventory.relations.filter(t=>t.schema==='public'&&t.kind==='r').length,10);
    assert.equal(snapshot.inventory.relations.some(t=>t.name==='pending_booking_extensions'),false);
    assert.equal(snapshot.structure.columns.some(c=>c.table==='booking_holds'&&c.name==='checkout_metadata'),false);
    assert.equal(snapshot.extra.storage_bucket_configuration.length,0);
    for(const name of ['bookings_listing_id_fkey','booking_holds_listing_id_fkey','bookings_renter_id_fkey','listings_host_id_fkey'])
      assert.match(snapshot.structure.constraints.find(c=>c.name===name).definition,/ON DELETE CASCADE/);
  });
  // Replay existing reviewed prerequisites ONLY inside the disposable service.
  // This is an ordered experiment, not a production migration bundle/history repair.
  const prepareBaseline=async db=>{
    for(const path of ['supabase-migration-010-preserve-bookings-on-listing-delete.sql',
      'supabase-migration-011-registered-checkouts.sql','supabase-migration-012-host-role-listings-rls.sql',
      'supabase-migration-013-listing-photos-storage.sql']) await install(db,path);
  };
  await runSchemaProbes(db,report,{snapshot,prepareBaseline});
  assert.equal(report.findings?.length??0,0,'Unresolved production-shaped core finding');
  const host='00000000-0000-4000-8000-00000000f101',driver='00000000-0000-4000-8000-00000000f102';
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'preserve-host@example.invalid','{"role":"host"}'),($2,'preserve-driver@example.invalid','{"role":"driver"}')`,[host,driver]);
  const listing=(await db.query(`insert into public.listings(host_id,title,address,price,spaces) values($1,'Synthetic preserved listing','Historic address M5V 2T6',12,4) returning id`,[host])).rows[0].id;
  const booking=(await db.query(`insert into public.bookings(listing_id,renter_id,hours,total,status,paid_at,booking_date,start_hour,spot_label) values($1,$2,2,24,'confirmed','2026-10-17T12:00Z','2026-12-20',14,'A') returning id`,[listing,driver])).rows[0].id;
  const original=(await db.query('select to_jsonb(b) data from public.bookings b where id=$1',[booking])).rows[0].data;
  await runPhotoCleanupProbe(db,report);
  await runRefundLedgerProbe(db,report);
  await runPublicParkingProbe(db,report);
  await runListingTimezoneProbe(db,report);
  await runListingPublicationProbe(db,report,async()=>{const peer=new pg.Client({connectionString:raw,connectionTimeoutMillis:5000});await peer.connect();return peer;});
  await runExtensionSettlementProbe(db,report);
  await install(db,'supabase/migrations/20261021104409_booking_reminder_delivery_005226_005261.sql');
  await runRefundNotificationsProbe(db,report);
  await install(db,'supabase/migrations/20261021200835_exception_horizon_005138.sql');
  await runInitialBookingRefundProbe(db,report);
  await runExtensionCapacityProbe(db,report);
  await check('all pre-existing synthetic paid booking fields survive the later migration chain unchanged',async()=>{
    const latest=(await db.query('select to_jsonb(b) data from public.bookings b where id=$1',[booking])).rows[0].data;
    for(const [key,value] of Object.entries(original))assert.deepEqual(latest[key],value,key);
  });
  await check('final privacy, financial retention, private photo bucket and service queues are present',async()=>{
    const state=(await db.query(`select (select count(*)::int from pg_constraint where conname=any(array['bookings_listing_id_fkey','booking_holds_listing_id_fkey','bookings_renter_id_fkey','listings_host_id_fkey']) and confdeltype='r') restricted,
      has_table_privilege('anon','public.listings','select') public_listings,
      (select public from storage.buckets where id='listing-photos') public_photos,
      to_regclass('public.booking_reminder_deliveries')::text reminders,
      to_regclass('public.refund_email_deliveries')::text refunds,
      to_regnamespace('qa_release_backup_20261019')::text qa_backup`)).rows[0];
    assert.deepEqual(state,{restricted:4,public_listings:false,public_photos:false,reminders:'booking_reminder_deliveries',refunds:'refund_email_deliveries',qa_backup:null});
  });
  console.log(`PASS: ${report.checks.length} production-shaped SQL checks. Production release remains on HOLD.`);
} catch(error) {
  report.error={code:error.code??null,message:error.message};
  console.error('Production-shaped rehearsal FAILED:',error.message);process.exitCode=1;
} finally {
  await writeFile('production-schema-rehearsal-results.json',JSON.stringify(report,null,2)+'\n');
  await client.end();
}
