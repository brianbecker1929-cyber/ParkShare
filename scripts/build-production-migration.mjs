// Deterministic, reviewable production package. Builds files; never connects to DB.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),base=new URL('deployment/production-database/',root);
const SOURCE_COMMIT='072629e16b35970bcae1260ab2e5660ece2b08d8';
const sha=s=>createHash('sha256').update(s).digest('hex');
const sources=[
 'supabase-migration-010-preserve-bookings-on-listing-delete.sql',
 'supabase-migration-011-registered-checkouts.sql',
 'supabase-migration-012-host-role-listings-rls.sql',
 'supabase-migration-013-listing-photos-storage.sql',
 ...['bug-005118-unpaid-hold-rate-limits.sql','qa-atomic-extensions-and-refunds.sql','bug-005156-property-local-canonical-bookings.sql','bug-005136-listing-postal-validation.sql','bug-005137-hourly-price-constraint.sql','bug-005138-future-exceptions.sql','qa-verified-reviews.sql','bug-005183-restrict-public-data-api.sql','qa-account-deletion-booking-retention.sql','qa-private-messages-rls.sql'].map(f=>'docs/sql-proposals/'+f),
 ...(await readdir(new URL('supabase/migrations/',root))).filter(f=>f.endsWith('.sql')&&f>'20261019135322_betterqa_verified_listing_zones_oct19.sql').sort().map(f=>'supabase/migrations/'+f),
 'docs/sql-proposals/qa-message-notifications-005536.sql'
];
const files=(await readdir(new URL('supabase/migrations/',base))).filter(f=>f.endsWith('_production_release_candidate.sql'));
assert.equal(files.length,1,'Create exactly one production migration using supabase migration new in this separate workdir');
const fingerprint=await readFile(new URL('schema-fingerprint.sql',base),'utf8');
const snapshot=await readFile(new URL('test/database/fixtures/production-schema-nov11.json',root),'utf8');
const inputs=[],sections=[];
for(const path of sources){
 const original=await readFile(new URL(path,root),'utf8');
 let sql=original.replace(/^\s*(?:begin|commit);\s*$/gim,'').replace(/^\s*set local (?:lock_timeout|statement_timeout)\s*=.*;\s*$/gim,'');
 // Old deployment warnings remain in the provenance sources; this bundle has its own gates.
 sql=sql.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n').trim();
 if(path==='supabase-migration-013-listing-photos-storage.sql'){
  assert.ok(sql.includes("'listing-photos', 'listing-photos', true, 10485760"));
  sql=sql.replace("'listing-photos', 'listing-photos', true, 10485760","'listing-photos', 'listing-photos', false, 10485760");
 }
 assert.ok(!/qa_release_backup_|verified_zone_cells|vault\.|net\.http|cron\.schedule|heqxirlsorcztsawaldg|biydlfekindgaslgktsx/.test(sql),'QA recovery content must never enter production bundle: '+path);
 inputs.push({path,sha256:sha(original),adaptation:path.includes('013-')?'Private bucket at creation; transaction wrapper/comments removed':'Transaction wrapper/comments removed'});
 sections.push(`-- Source ${inputs.length}: ${path}\n${sql}\n`);
}
const inputsHash=sha(JSON.stringify(inputs));
const header=`-- ParkShare production candidate; PREPARATION ONLY. No hosted runner is included.
-- Generated from reviewed sources; NEVER run supabase db push from the QA migration directory.
-- A coordinated app/schema cutover, verified backup and scheduler hold remain mandatory.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(20261111,495);
DO $scope$
BEGIN
 IF current_setting('parkshare.migration_scope',true)='isolated-rehearsal' THEN
  IF current_database()<>'parkshare_production_rehearsal' THEN RAISE EXCEPTION 'Dedicated local rehearsal database required'; END IF;
 ELSIF current_setting('parkshare.migration_scope',true)='production-approved' THEN
  IF current_database()<>'postgres' OR current_setting('parkshare.target_project',true) IS DISTINCT FROM 'oyxrussraxjgqwzpwyca'
   OR current_setting('parkshare.backup_restore_verified',true) IS DISTINCT FROM 'yes'
   OR current_setting('parkshare.checkout_and_workers_paused',true) IS DISTINCT FROM 'yes' THEN
   RAISE EXCEPTION 'Production target, restore evidence and cutover controls must be explicitly confirmed'; END IF;
 ELSE RAISE EXCEPTION 'Migration scope is not approved'; END IF;
 IF to_regnamespace('parkshare_private') IS NOT NULL THEN RAISE EXCEPTION 'Private application schema already exists; do not reapply or overwrite newer work'; END IF;
END $scope$;
LOCK TABLE auth.users IN SHARE MODE;
LOCK TABLE storage.buckets,storage.objects IN SHARE MODE;
DO $locks$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
  EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',t.tablename);
 END LOOP;
END $locks$;
DO $baseline$ DECLARE observed text; BEGIN
 ${fingerprint.trim().replace(/ AS fingerprint;$/,' INTO observed;')}
 IF observed IS DISTINCT FROM 'c88a7b09cb3c4da5b99628cfe6d6a3a6' THEN RAISE EXCEPTION 'Production schema drifted; recapture, review and rehearse before proceeding'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage') OR EXISTS(SELECT 1 FROM storage.buckets)
  OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='storage.objects'::regclass) THEN
  RAISE EXCEPTION 'Storage baseline changed; review bucket and object policy boundaries before migration'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_holds WHERE expires_at>now()) THEN RAISE EXCEPTION 'Active checkout holds remain'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_holds WHERE stripe_checkout_session_id IS NOT NULL)
  AND current_setting('parkshare.retained_checkouts_reviewed',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Retained Checkout sessions require Stripe reconciliation before cutover'; END IF;
END $baseline$;
CREATE TEMP TABLE production_preservation_guard(table_name text PRIMARY KEY,columns text[] NOT NULL,n bigint NOT NULL,digest text NOT NULL) ON COMMIT DROP;
DO $capture$ DECLARE t record; cols text[]; n bigint; digest text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
  SELECT array_agg(attname::text ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid=format('public.%I',t.tablename)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(to_jsonb(s)::text,''|'' ORDER BY to_jsonb(s)::text),'''')) FROM public.%I s',t.tablename) INTO n,digest;
  INSERT INTO production_preservation_guard VALUES(t.tablename,cols,n,digest);
 END LOOP;
END $capture$;
`;
const tail=`
-- Every original column/value and original row count must survive all stages.
DO $preserve$ DECLARE t record; after_n bigint; after_digest text; BEGIN
 FOR t IN SELECT * FROM production_preservation_guard ORDER BY table_name LOOP
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(row::text,''|'' ORDER BY row::text),'''')) FROM (SELECT (SELECT jsonb_object_agg(k,v) FROM jsonb_each(to_jsonb(s)) j(k,v) WHERE k=ANY($1)) row FROM public.%I s) x',t.table_name) INTO after_n,after_digest USING t.columns;
  IF after_n<>t.n OR after_digest IS DISTINCT FROM t.digest THEN RAISE EXCEPTION 'Historical data changed in %; transaction refused',t.table_name; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.booking_refund_operations) OR EXISTS(SELECT 1 FROM public.booking_cancellation_reviews)
  OR EXISTS(SELECT 1 FROM public.payment_refunds) OR EXISTS(SELECT 1 FROM public.booking_reminder_deliveries)
  OR EXISTS(SELECT 1 FROM public.refund_email_deliveries) OR EXISTS(SELECT 1 FROM public.message_email_deliveries)
  OR EXISTS(SELECT 1 FROM public.listing_photo_cleanup) THEN RAISE EXCEPTION 'Migration must not create historical notifications, money jobs or deletions'; END IF;
END $preserve$;
CREATE TABLE parkshare_private.production_release_versions (
 package_id text PRIMARY KEY,source_commit text NOT NULL,inputs_sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE parkshare_private.production_release_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parkshare_private.production_release_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON parkshare_private.production_release_versions TO service_role;
INSERT INTO parkshare_private.production_release_versions(package_id,source_commit,inputs_sha256)
 VALUES('production-candidate-2026-11-11','${SOURCE_COMMIT}','${inputsHash}');
NOTIFY pgrst,'reload schema';
COMMIT;
`;
const sql=header+sections.join('\n')+tail;
const manifest={packageId:'production-candidate-2026-11-11',status:'rehearsal-only; production execution requires separate approval',sourceCommit:SOURCE_COMMIT,productionCommit:'8c80feab4596e238eb46f585de5b8e1f2cf4b433',targetProject:'oyxrussraxjgqwzpwyca',baselineFingerprint:'c88a7b09cb3c4da5b99628cfe6d6a3a6',baselineFixtureSha256:sha(snapshot),inputsSha256:inputsHash,migrationFile:'supabase/migrations/'+files[0],migrationSha256:sha(sql),transaction:'One transaction; no intermediate committed stages',sources:inputs,excluded:['QA combined recovery installer and backup schema','QA geography cell backfill','QA pg_cron/pg_net/Vault bootstrap','Auth/customer rows and QA staff flags','Historical notification/money queue backfills','Any Stripe, Resend, Storage object or HTTP request']};
await writeFile(new URL(manifest.migrationFile,base),sql);
await writeFile(new URL('manifest.json',base),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({sources:inputs.length,bytes:Buffer.byteLength(sql),migration:manifest.migrationFile,sha256:manifest.migrationSha256}));
