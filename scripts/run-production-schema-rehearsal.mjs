import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {runCancellationFeeProbe} from './qa-cancellation-fee-probe.mjs';
import {runRefundNotificationsProbe} from './qa-refund-notifications-probe.mjs';
import {profilePrivacyChecks} from './qa-profile-privacy-probes.mjs';
import {seedMessagePrivacyRows,messagePrivacyChecks} from './qa-message-privacy-probes.mjs';
import {runInitialBookingRefundProbe} from './qa-initial-booking-refund-probe.mjs';
import {runExtensionSettlementProbe} from './qa-extension-settlement-probe.mjs';
import {runProductionDeliveryProbes} from './production-delivery-probes.mjs';
import {assertProductionRehearsalUrl,restoreProductionSnapshot,seedProductionShape} from './production-schema-rehearsal.mjs';
const config=assertProductionRehearsalUrl(process.env.PRODUCTION_SCHEMA_REHEARSAL_DATABASE_URL);
const c=new pg.Client(config);
const report={checks:[],status:'running',productionWrites:0,providerCalls:0};
try {
 await c.connect();
 const env=(await c.query('SELECT current_database() db,version() engine,host(inet_server_addr()) address')).rows[0];
 assert.equal(env.db,'parkshare_production_rehearsal');assert.match(env.engine,/^PostgreSQL 17\./);assert.ok(['127.0.0.1','::1'].includes(env.address));report.engine=env.engine;
 const db={query:(sql,args)=>c.query(sql,args),exec:sql=>c.query(sql)};
 const s=await restoreProductionSnapshot(db);
 await db.exec('SET search_path=public,extensions');
 const fingerprint=(await db.query(await readFile(new URL('../deployment/production-database/schema-fingerprint.sql',import.meta.url),'utf8'))).rows[0].fingerprint;
 assert.equal(fingerprint,'c88a7b09cb3c4da5b99628cfe6d6a3a6','Local restored production application catalog must match the live read-only fingerprint');
 report.checks.push({name:'Restored production catalog fingerprint matches hosted read-only capture',status:'passed'});
 report.baseline={fingerprint,tables:s.inventory.relations.filter(x=>x.kind==='r').length,columns:s.structure.columns.length,constraints:s.structure.constraints.length,policies:s.inventory.policies.length,capturedAt:s.inventory.captured_at};
 const check=async(name,fn)=>{await fn();report.checks.push({name,status:'passed'});};
 const manifest=JSON.parse(await readFile(new URL('../deployment/production-database/manifest.json',import.meta.url),'utf8'));
 const hash=value=>createHash('sha256').update(value).digest('hex');
 assert.equal(hash(await readFile(new URL('fixtures/production-schema-nov11.json',new URL('../test/database/',import.meta.url)))),manifest.baselineFixtureSha256,'Captured schema fixture must match the manifest');
 for(const source of manifest.sources)assert.equal(hash(await readFile(new URL('../'+source.path,import.meta.url))),source.sha256,'SQL source changed: '+source.path);
 const sql=await readFile(new URL('../deployment/production-database/'+manifest.migrationFile,import.meta.url),'utf8');
 assert.equal(createHash('sha256').update(sql).digest('hex'),manifest.migrationSha256,'Built migration hash must match reviewed manifest');
 report.package={id:manifest.packageId,sha256:manifest.migrationSha256,sourceCommit:manifest.sourceCommit,sources:manifest.sources.length};
 const scope=()=>db.exec("SET parkshare.migration_scope='isolated-rehearsal';SET parkshare.retained_checkouts_reviewed='yes';");
 const rowDigest=async()=>{const result=[];for(const t of s.inventory.relations.filter(t=>t.schema==='public'&&t.kind==='r')){
  const cols=s.structure.columns.filter(x=>x.schema==='public'&&x.table===t.name).map(x=>x.name);
  result.push([t.name,(await db.query(`SELECT md5(coalesce(string_agg(row::text,'|' ORDER BY row::text),'')) digest FROM (SELECT (SELECT jsonb_object_agg(k,v) FROM jsonb_each(to_jsonb(s)) j(k,v) WHERE k=ANY($1)) row FROM public.${t.name} s) x`,[cols])).rows[0].digest]);
 }return Object.fromEntries(result);};
 await check('Unapproved execution is refused before any schema change',async()=>{
  await assert.rejects(()=>db.exec(sql),/Migration scope is not approved/);await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT to_regnamespace('parkshare_private')::text p")).rows[0].p,null);
 });
 await scope();
 await check('Baseline drift stops the entire package',async()=>{
  await db.exec('ALTER TABLE public.listings ADD COLUMN synthetic_drift text');
  await assert.rejects(()=>db.exec(sql),/schema drifted/);await db.exec('ROLLBACK');
  await db.exec('ALTER TABLE public.listings DROP COLUMN synthetic_drift');
 });
 // A fresh restore removes the deliberately dropped-column catalog artifact.
 await restoreProductionSnapshot(db);await scope();
 let fixture=await seedProductionShape(db,{duplicateReviews:true});
 const failureBefore=await rowDigest();
 await check('A late duplicate-review failure rolls back all earlier DDL, bucket metadata and financial changes',async()=>{
  await assert.rejects(()=>db.exec(sql),e=>e.code==='23505');await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT to_regclass('public.pending_booking_extensions')::text p")).rows[0].p,null);
  assert.equal((await db.query('SELECT count(*)::int n FROM storage.buckets')).rows[0].n,0);
  assert.deepEqual(await rowDigest(),failureBefore);
 });
 await restoreProductionSnapshot(db);await scope();fixture=await seedProductionShape(db);
 await check('A changed Storage policy baseline blocks migration before private-photo rules can be weakened',async()=>{
  await db.exec('CREATE POLICY synthetic_broad_storage_read ON storage.objects FOR SELECT TO anon USING(true)');
  await assert.rejects(()=>db.exec(sql),/Storage baseline changed/);await db.exec('ROLLBACK');
  await db.exec('DROP POLICY synthetic_broad_storage_read ON storage.objects');
 });
 // Simulate one retained pre-upgrade Checkout intent; no credentials/provider calls.
 await db.query("INSERT INTO public.booking_holds(listing_id,renter_id,spot_label,starts_at,ends_at,expires_at,stripe_checkout_session_id) VALUES($1,$2,'D',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day','cs_retained_synthetic')",[fixture.listing,fixture.driver]);
 await check('Retained legacy Checkout evidence requires an explicit reconciliation acknowledgement',async()=>{
  await db.exec("SET parkshare.retained_checkouts_reviewed='no'");await assert.rejects(()=>db.exec(sql),/Retained Checkout/);await db.exec('ROLLBACK');await scope();
 });
 await check('Active Checkout holds block cutover even after acknowledgement',async()=>{
  await db.exec("UPDATE public.booking_holds SET expires_at=now()+interval '10 minutes'");
  await assert.rejects(()=>db.exec(sql),/Active checkout holds/);await db.exec('ROLLBACK');
  await db.exec("UPDATE public.booking_holds SET expires_at=now()-interval '1 day'");
 });
 const before=await rowDigest();
 await check('Preservation guard detects an injected historical-field rewrite and rolls back the complete package',async()=>{
  const injected=sql.replace('-- Every original column/value',"UPDATE public.bookings SET confirmation_email_sent_at='2026-11-11T00:00Z';\n-- Every original column/value");
  await assert.rejects(()=>db.exec(injected),/Historical data changed/);await db.exec('ROLLBACK');assert.deepEqual(await rowDigest(),before);
 });
 await check('Complete production package commits against the exact restored production catalog',async()=>{await db.exec(sql);});
 await check('All original columns and rows survive: 29 paid bookings, two extensions, messages, profiles, reviews and listing data',async()=>{
  assert.deepEqual(await rowDigest(),before);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.bookings WHERE paid_at IS NOT NULL')).rows[0].n,29);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.messages WHERE recipient_id IS NULL')).rows[0].n,7);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.listings WHERE time_zone IS NULL')).rows[0].n,1);
 });
 report.fixture={bookings:29,extensions:2,unaddressedMessages:7,retainedCheckouts:1,customerRowsExported:0};
 const queueTables=['booking_refund_operations','booking_cancellation_reviews','payment_refunds','booking_reminder_deliveries','refund_email_deliveries','message_email_deliveries','listing_photo_cleanup'];
 await check('No historical email, refund, fee-credit or photo-deletion work is queued',async()=>{for(const t of queueTables)assert.equal((await db.query(`SELECT count(*)::int n FROM public.${t}`)).rows[0].n,0);});
 await check('Browser roles cannot read or write private money/delivery queues; every new public table uses RLS',async()=>{
  for(const t of queueTables){assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',['public.'+t])).rows[0].relrowsecurity,true);
   for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) allowed',[role,'public.'+t,privilege])).rows[0].allowed,false);
  }
  for(const t of ['booking_hold_attempts','pending_booking_extensions'])for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,'public.'+t])).rows[0].allowed,false);
 });
 await check('Required application RPCs are service-only and readiness probes return true',async()=>{
  const names=['reconcile_payment_refunds','public_parking_page','reserve_extension_checkout_hold','apply_paid_booking_extension','settle_initial_booking_checkout','publish_host_listing','reserve_booking_refund','claim_booking_refund','allocate_refund_fee_credit','listing_photo_cleanup_batch'];
  for(const name of names){const signatures=(await db.query("SELECT p.oid::regprocedure::text sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1",[name])).rows;assert.ok(signatures.length,name);
   for(const {sig}of signatures){for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,sig])).rows[0].allowed,false);assert.equal((await db.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') allowed",[sig])).rows[0].allowed,true);}}
  await db.exec('BEGIN;SET LOCAL ROLE service_role');try{assert.equal((await db.query('SELECT listing_timezone_assignment_ready() ready')).rows[0].ready,true);assert.equal((await db.query('SELECT listing_publication_ready() ready')).rows[0].ready,true);await db.query('SELECT * FROM public_parking_page(1)');}finally{await db.exec('ROLLBACK');}
 });
 for(const [name,run]of profilePrivacyChecks(db,fixture))await check(name,run);
 await check('Financial FKs prevent listing, profile or Auth deletion from cascading away paid history',async()=>{
  for(const [query,args]of [['DELETE FROM public.listings WHERE id=$1',[fixture.listing]],['DELETE FROM public.profiles WHERE id=$1',[fixture.driver]],['DELETE FROM auth.users WHERE id=$1',[fixture.host]]]){
   await db.exec('BEGIN');try{await assert.rejects(()=>db.query(query,args),e=>e.code==='23503');}finally{await db.exec('ROLLBACK');}
  }
 });
 await check('New canonical scheduled bookings use the supplied UTC instant and retain the property-zone snapshot',async()=>{
  await db.exec('BEGIN');try{
   const b=(await db.query("INSERT INTO public.bookings(listing_id,renter_id,hours,total,status,paid_at,booking_date,start_hour,scheduled_starts_at,property_time_zone) VALUES($1,$2,2,24,'confirmed',now(),'2026-12-31',10,'2026-12-31T15:00Z','America/Toronto') RETURNING lower(session_range) starts,upper(session_range) ends,property_time_zone",[fixture.listing,fixture.driver])).rows[0];
   assert.equal(b.starts.toISOString(),'2026-12-31T15:00:00.000Z');assert.equal(b.ends.toISOString(),'2026-12-31T17:00:00.000Z');assert.equal(b.property_time_zone,'America/Toronto');
  }finally{await db.exec('ROLLBACK');}
 });
 await check('Direct Host requests cannot rewrite trusted property coordinates or time zones',async()=>{
  await db.exec('BEGIN');try{
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[fixture.host]);await db.exec('SET LOCAL ROLE authenticated');
   await assert.rejects(()=>db.query("UPDATE public.listings SET time_zone='Pacific/Kiritimati',lat=1 WHERE id=$1",[fixture.listing]),e=>e.code==='42501');
  }finally{await db.exec('ROLLBACK');}
 });
 await check('Photo bucket starts private and Storage policies scope writes to the owning Host',async()=>{
  const b=(await db.query("SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='listing-photos'")).rows[0];
  assert.equal(b.public,false);assert.equal(Number(b.file_size_limit),10485760);assert.deepEqual(b.allowed_mime_types,['image/jpeg','image/png','image/webp']);
  await db.exec('BEGIN');try{
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[fixture.host]);await db.exec('SET LOCAL ROLE authenticated');
   await db.query("INSERT INTO storage.objects(bucket_id,name,owner) VALUES('listing-photos',$1,$2)",[fixture.host+'/synthetic.jpg',fixture.host]);
   assert.equal((await db.query('SELECT count(*)::int n FROM storage.objects')).rows[0].n,1);
  }finally{await db.exec('ROLLBACK');}
  await db.exec('BEGIN');try{
   await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[fixture.driver]);await db.exec('SET LOCAL ROLE authenticated');
   await assert.rejects(()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner) VALUES('listing-photos',$1,$2)",[fixture.driver+'/forged.jpg',fixture.driver]),e=>e.code==='42501');
  }finally{await db.exec('ROLLBACK');}
 });
 const privacyListing=(await db.query("INSERT INTO public.listings(host_id,title,address,price,spaces,time_zone) VALUES($1,'Synthetic isolated conversation','Toronto ON M5V 2T6',12,2,'America/Toronto') RETURNING id",[fixture.host])).rows[0].id;
 const people={...fixture,listing:privacyListing};
 const ids=await seedMessagePrivacyRows(db,people);
 for(const [name,run]of messagePrivacyChecks(db,{...people,ids}))await check(name,run);
 await runRefundNotificationsProbe(db,report,{installMigration:false});
 await runCancellationFeeProbe(db,report,{installMigration:false});
 await runInitialBookingRefundProbe(db,report,{installMigration:false});
 await runExtensionSettlementProbe(db,report,{installMigration:false});
 await runProductionDeliveryProbes(db,report,config,fixture);
 await check('Read-only postflight SQL executes and reports zero RLS or browser-queue privilege failures',async()=>{
  const results=await db.exec(await readFile(new URL('../deployment/production-database/postflight-readonly.sql',import.meta.url),'utf8'));
  const rows=results.flatMap(r=>r.rows??[]).filter(r=>'failures' in r);assert.equal(rows.length,2);for(const row of rows)assert.equal(Number(row.failures),0,row.check_name);
 });
 await check('Blind reapplication is refused without changing committed data or queues',async()=>{
  const installed=await rowDigest();await assert.rejects(()=>db.exec(sql),/already exists/);await db.exec('ROLLBACK');assert.deepEqual(await rowDigest(),installed);
 });
 report.completedAt=new Date().toISOString();report.status='passed';console.log(`PASS: ${report.checks.length} production migration checks; ${manifest.sources.length} reviewed SQL sources.`);
} catch(e){report.status='failed';report.error={code:e.code??null,message:e.message};console.error(e);process.exitCode=1;}
finally{await writeFile(new URL('../deployment/production-database/evidence/rehearsal-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');await c.end();}
