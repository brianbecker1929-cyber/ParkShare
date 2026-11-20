// Synthetic records in a validated disposable database ONLY.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const listingPauseMigration=new URL('../supabase/migrations/20261101195507_qa_listing_pause_005445.sql',import.meta.url);
export async function runListingPauseProbe(db,report={checks:[]},connectPeer) {
 const check=name=>report.checks.push({name:'listing pause: '+name,status:'passed'});
 const before=(await db.query("select md5(coalesce(string_agg(to_jsonb(b)::text,'|' order by id),'')) digest from public.bookings b")).rows[0].digest;
 const sql=await readFile(listingPauseMigration,'utf8');await db.exec(sql);await db.exec(sql);
 report.migrations??=[];report.migrations.push({name:'qa_listing_pause_005445',status:'passed'});
 assert.equal((await db.query("select md5(coalesce(string_agg(to_jsonb(b)::text,'|' order by id),'')) digest from public.bookings b")).rows[0].digest,before);check('idempotent additive migration preserves booking history');
 const host='00000000-0000-4000-8000-00000000f445',driver='00000000-0000-4000-8000-00000000f446';
 const seed=async()=>{
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'pause-host@example.invalid','{"role":"host"}'),($2,'pause-driver@example.invalid','{"role":"driver"}')`,[host,driver]);
  return (await db.query(`insert into public.listings(host_id,title,address,price,spaces,spots,time_zone,availability) values($1,'Synthetic pause fixture','Toronto ON M5V 2T6',12,2,'[{"forRent":true},{"forRent":true}]','America/Toronto','{"version":1,"preset":"anytime","timezone":"America/Toronto","weekly":{},"exceptions":[]}'::jsonb) returning id`,[host])).rows[0].id;
 };
 const hold=(connection,id,label='A')=>connection.query(`select public.create_booking_hold($1,$2,$3,now()+interval '2 hours',now()+interval '3 hours',now()+interval '30 minutes') id`,[id,driver,label]);
 await db.exec('begin;');
 try {
  const id=await seed();assert.equal((await db.query('select is_paused from public.listings where id=$1',[id])).rows[0].is_paused,false);check('existing and new listings default active');
  const admitted=(await hold(db,id)).rows[0].id;
  const booking=(await db.query(`insert into public.bookings(listing_id,renter_id,status,hours,total,paid_at,spot_label) values($1,$2,'confirmed',1,12,now(),'B') returning to_jsonb(bookings) row`,[id,driver])).rows[0].row;
  const original=(await db.query('select availability from public.listings where id=$1',[id])).rows[0].availability;
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[host]);await db.exec('set local role authenticated;');
  const own=await db.query('update public.listings set is_paused=true where id=$1 returning id',[id]);assert.equal(own.rows.length,1);await db.exec('reset role;');check('Host RLS permits own pause');
  await db.exec('savepoint blocked;');await assert.rejects(()=>hold(db,id,'B'),e=>e.code==='P0063');await db.exec('rollback to savepoint blocked;');check('paused listing rejects new hold before any allocation');
  assert.equal((await db.query('select count(*)::int n from public.booking_holds where id=$1',[admitted])).rows[0].n,1);
  assert.deepEqual((await db.query('select to_jsonb(b) row from public.bookings b where id=$1',[booking.id])).rows[0].row,booking);
  assert.deepEqual((await db.query('select availability from public.listings where id=$1',[id])).rows[0].availability,original);check('pause preserves prior hold, booked reservation and schedule');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[driver]);await db.exec('set local role authenticated;');assert.equal((await db.query('update public.listings set is_paused=false where id=$1 returning id',[id])).rows.length,0);await db.exec('reset role;');check('another account cannot resume the listing');
  for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'parkshare_private.reject_paused_listing_hold_005445()','EXECUTE') allowed",[role])).rows[0].allowed,false);check('browser roles cannot invoke pause trigger');
  await db.query('update public.listings set is_paused=false where id=$1',[id]);await db.query('delete from public.booking_holds where id=$1',[admitted]);assert.ok((await hold(db,id)).rows[0].id);check('resume admits new hold without replacing schedule');
 } finally {await db.exec('rollback;');}
 if(connectPeer){
  const id=await seed(),peer=await connectPeer();
  try {
   await db.exec('begin;');await db.query('update public.listings set is_paused=true where id=$1',[id]);
   await peer.query("set lock_timeout='3s'");
   let finished=false;const pending=hold(peer,id).then(()=>{finished=true;return null;},error=>{finished=true;return error;});
   await new Promise(resolve=>setTimeout(resolve,80));assert.equal(finished,false,'Hold admission must wait for pause row lock');await db.exec('commit;');assert.equal((await pending)?.code,'P0063');check('concurrent admission waits for committed pause and then rejects');
  } finally {
   await db.exec('rollback;');await peer.end();await db.query('delete from public.booking_hold_attempts where renter_id=$1',[driver]);await db.query('delete from public.booking_holds where listing_id=$1',[id]);await db.query('delete from public.listings where id=$1',[id]);await db.query('delete from public.profiles where id=any($1::uuid[])',[[host,driver]]);await db.query('delete from auth.users where id=any($1::uuid[])',[[host,driver]]);
  }
 }
}
