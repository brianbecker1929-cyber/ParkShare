// Disposable Postgres/PGlite probe. Caller MUST validate local connection before use.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadSnapshot,restoreSnapshot} from './qa-schema-rehearsal.mjs';
export const releaseMigrationUrl=new URL('../supabase/migrations/20261019135228_betterqa_complete_qa_release_oct19.sql',import.meta.url);
export async function runCompleteQaReleaseProbe(db,report){
 const check=async(name,fn)=>{await fn();report.checks.push({name,status:'passed'});};
 await db.exec('DROP SCHEMA IF EXISTS qa_release_backup_20261019 CASCADE;');
 await restoreSnapshot(db,await loadSnapshot());
 const host='00000000-0000-4000-8000-00000000d191',driver='00000000-0000-4000-8000-00000000d192';
 for(const [id,role] of [[host,'host'],[driver,'driver']])await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,jsonb_build_object('name','Synthetic release','role',$3::text))",[id,role+'@example.invalid',role]);
 const listing=(await db.query("INSERT INTO public.listings(host_id,title,address,price,spaces) VALUES($1,'Synthetic release listing','Preserved historical address',12,2) RETURNING id",[host])).rows[0].id;
 await db.query('UPDATE public.listings SET lat=43.82,lng=-79.45 WHERE id=$1',[listing]);
 const booking=(await db.query("INSERT INTO public.bookings(listing_id,renter_id,hours,total,status,booking_date,start_hour,spot_label,paid_at) VALUES($1,$2,2,24,'confirmed','2026-12-20',14,'A','2026-10-17T12:00Z') RETURNING id",[listing,driver])).rows[0].id;
 const original=(await db.query('SELECT to_jsonb(b) row FROM public.bookings b WHERE id=$1',[booking])).rows[0].row;
 await db.query("INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES($1,$2,5,'Synthetic duplicate'),($1,$2,4,'Synthetic duplicate')",[listing,driver]);
 const migration=await readFile(releaseMigrationUrl,'utf8');
 await check('atomic QA release rolls back all schema/backup changes when late unique-review check fails',async()=>{
  await assert.rejects(db.exec(migration),error=>error.code==='23505');await db.exec('ROLLBACK;');
  const state=(await db.query("SELECT to_regnamespace('qa_release_backup_20261019')::text backup, to_regclass('public.booking_hold_attempts')::text quota, (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='scheduled_starts_at') canonical")).rows[0];
  assert.deepEqual(state,{backup:null,quota:null,canonical:0});
  assert.deepEqual((await db.query('SELECT to_jsonb(b) row FROM public.bookings b WHERE id=$1',[booking])).rows[0].row,original);
 });
 await db.exec('DELETE FROM public.reviews WHERE id=(SELECT max(id) FROM public.reviews)');
 await check('versioned QA release installs all ten repairs and a matching private recovery copy',async()=>{
  await db.exec(migration);
  assert.equal((await db.query('SELECT count(*)::int n FROM qa_release_backup_20261019.table_counts')).rows[0].n,11);
  assert.equal((await db.query("SELECT has_schema_privilege('anon','qa_release_backup_20261019','USAGE') allowed")).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_schema_privilege('authenticated','qa_release_backup_20261019','USAGE') allowed")).rows[0].allowed,false);
  assert.deepEqual((await db.query('SELECT to_jsonb(b) row FROM qa_release_backup_20261019.bookings b WHERE id=$1',[booking])).rows[0].row,original);
  const updated=(await db.query("SELECT to_jsonb(b)-'scheduled_starts_at'-'property_time_zone' row FROM public.bookings b WHERE id=$1",[booking])).rows[0].row;
  assert.deepEqual(updated,original);assert.equal((await db.query("SELECT public FROM storage.buckets WHERE id='listing-photos'")).rows[0].public,false);
 });
 await check('trusted QA geography assigns only verified cells and preserves every paid booking field',async()=>{
  await db.exec("INSERT INTO qa_release_backup_20261019.verified_zone_cells(south,west,time_zone,verified_source) VALUES(43.8,-79.5,'America/Toronto','geo-tz@8.1.10')");
  await db.exec(await readFile(new URL('../supabase/migrations/20261019135322_betterqa_verified_listing_zones_oct19.sql',import.meta.url),'utf8'));
  assert.equal((await db.query('SELECT time_zone FROM public.listings WHERE id=$1',[listing])).rows[0].time_zone,'America/Toronto');
  assert.deepEqual((await db.query("SELECT to_jsonb(b)-'scheduled_starts_at'-'property_time_zone' row FROM public.bookings b WHERE id=$1",[booking])).rows[0].row,original);
 });
 await check('versioned QA release rejects blind reapply and keeps committed history intact',async()=>{
  await assert.rejects(db.exec(migration),error=>error.code==='42P06');await db.exec('ROLLBACK;');
  assert.deepEqual((await db.query("SELECT to_jsonb(b)-'scheduled_starts_at'-'property_time_zone' row FROM public.bookings b WHERE id=$1",[booking])).rows[0].row,original);
 });
}
