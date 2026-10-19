// Disposable/local schema only. All identifiers and URLs here are synthetic.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const photoCleanupMigration = new URL('../supabase/migrations/20261019164722_listing_photo_cleanup_005187.sql',import.meta.url);
export async function runPhotoCleanupProbe(db,report={checks:[]}) {
 const migration=await readFile(photoCleanupMigration,'utf8');
 await db.exec(migration);
 const check=(name)=>report.checks.push({name:'photo cleanup: '+name,status:'passed'});
 const host='00000000-0000-4000-8000-000000000041',other='00000000-0000-4000-8000-000000000042';
 const file='00000000-0000-4000-8000-000000000051.jpg',file2='00000000-0000-4000-8000-000000000052.png';
 const url=(owner,name)=>`https://synthetic.invalid/storage/v1/object/public/listing-photos/${owner}/${name}`;
 // Do not overwrite fixture/application rows: a rolled-back synthetic transaction.
 await db.exec('BEGIN;');
 try {
  await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'photo-host@example.invalid','{"name":"Synthetic Host","role":"host"}'),($2,'photo-driver@example.invalid','{"name":"Synthetic Driver","role":"driver"}')`,[host,other]);
  const insert=async(img,photos=[])=>Number((await db.query(`INSERT INTO public.listings(host_id,title,address,price,spaces,img,photos) VALUES($1,'Synthetic fixture','Toronto ON M5V 2T6',10,1,$2,$3) RETURNING id`,[host,img,JSON.stringify(photos)])).rows[0].id);
  const a=await insert(url(host,file),[url(host,file),url(host,file2),url(other,file),'data:image/png;base64,synthetic','https://outside.invalid/photo.jpg']);
  await db.query('DELETE FROM public.listings WHERE id=$1',[a]);
  let jobs=(await db.query('SELECT object_path FROM public.listing_photo_cleanup ORDER BY object_path')).rows;
  assert.deepEqual(jobs.map(j=>j.object_path),[`${host}/${file}`,`${host}/${file2}`]);check('only owned Storage paths queued once, including cover');
  const shared=await insert(url(host,file));
  assert.equal((await db.query('SELECT * FROM public.listing_photo_cleanup_batch(NULL,50)')).rows.length,1);check('shared photo withheld');
  await db.query('DELETE FROM public.listings WHERE id=$1',[shared]);
  assert.equal((await db.query('SELECT * FROM public.listing_photo_cleanup_batch(NULL,50)')).rows.length,2);check('last reference deletion releases shared photo');
  await db.query(`UPDATE public.listing_photo_cleanup SET next_attempt_at=now()+interval '1 hour'`);
  assert.equal((await db.query('SELECT * FROM public.listing_photo_cleanup_batch(NULL,50)')).rows.length,0);check('retry delay respected');
  for(const role of ['anon','authenticated']){
   for(const sql of ['SELECT * FROM public.listing_photo_cleanup','SELECT * FROM public.listing_photo_cleanup_batch(NULL,50)']){
    await db.exec('SAVEPOINT denied;');await db.exec('SET LOCAL ROLE '+role);
    await assert.rejects(db.query(sql),e=>e.code==='42501');await db.exec('ROLLBACK TO SAVEPOINT denied;');
   }
  }check('browser queue and RPC access denied');
  await db.exec('SAVEPOINT private_function;');await db.exec('SET LOCAL ROLE authenticated;');
  await assert.rejects(db.query('SELECT parkshare_private.queue_deleted_listing_photos()'),e=>e.code==='42501');
  await db.exec('ROLLBACK TO SAVEPOINT private_function;');check('trigger function private');
  // Prove the definer trigger works under the actual Host RLS role.
  const own=await insert(url(host,file));
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[host]);await db.exec('SET LOCAL ROLE authenticated;');
  await db.query('DELETE FROM public.listings WHERE id=$1',[own]);await db.exec('RESET ROLE;');
  assert.equal((await db.query('SELECT count(*)::int count FROM public.listings WHERE id=$1',[own])).rows[0].count,0);check('Host deletion can enqueue without private schema access');
  await db.query("SELECT set_config('request.jwt.claim.sub','',true)");
  const booked=await insert(url(host,file));
  await db.query(`INSERT INTO public.bookings(listing_id,renter_id,status,hours,total,paid_at) VALUES($1,$2,'confirmed',1,10,now())`,[booked,other]);
  await db.exec('SAVEPOINT protected;');await assert.rejects(db.query('DELETE FROM public.listings WHERE id=$1',[booked]),e=>e.code==='23503');await db.exec('ROLLBACK TO SAVEPOINT protected;');
  assert.equal((await db.query('SELECT count(*)::int count FROM public.listing_photo_cleanup WHERE listing_id=$1',[booked])).rows[0].count,0);check('FK-blocked deletion queues nothing');
 } finally {await db.exec('ROLLBACK;');}
 return report;
}
