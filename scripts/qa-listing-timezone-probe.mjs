import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export const listingTimezoneMigration=new URL('../supabase/migrations/20261019201855_listing_timezone_assignment.sql',import.meta.url);
export async function runListingTimezoneProbe(db,report={checks:[]}){
 const check=name=>report.checks.push({name:'listing timezone: '+name,status:'passed'});
 const digest=async()=> (await db.query("SELECT md5(coalesce(string_agg(to_jsonb(b)::text,'|' ORDER BY id),'')) digest FROM public.bookings b")).rows[0].digest;
 const original=await digest();await db.exec(await readFile(listingTimezoneMigration,'utf8'));assert.equal(await digest(),original);check('migration preserves every historical booking field');
 for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,'public.listing_timezone_assignment_ready()','EXECUTE') allowed",[role])).rows[0].allowed,false);
 check('readiness RPC is server-only');
 await db.exec('BEGIN;');
 try{
  const host='00000000-0000-4000-8000-000000000081',driver='00000000-0000-4000-8000-000000000082';
  await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'zone-host@example.invalid','{"name":"Synthetic Host","role":"host"}'),($2,'zone-driver@example.invalid','{"name":"Synthetic Driver","role":"driver"}')`,[host,driver]);
  const row=(await db.query(`INSERT INTO public.listings(host_id,title,address,price,spaces,lat,lng,time_zone) VALUES($1,'Synthetic location','Test Toronto ON M5V 2T6',12,1,43.65,-79.38,'America/Toronto') RETURNING id`,[host])).rows[0];
  await db.exec('SAVEPOINT baseline;');
  async function rejected(sql,args=[]){await db.exec('SAVEPOINT denial;');try{await assert.rejects(()=>db.query(sql,args),error=>error.code==='42501');}finally{await db.exec('ROLLBACK TO SAVEPOINT denial;');}}
  await db.exec('SET LOCAL ROLE authenticated;');await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[host]);
  await rejected(`INSERT INTO public.listings(host_id,title,address,price,spaces,lat,lng) VALUES($1,'Bypass','Test Toronto ON M5V 2T6',12,1,43.65,-79.38)`,[host]);check('Host direct inserts cannot skip geographic verification');
  for(const [field,value] of [['lat',46.77],['lng',23.59],['address','Another test M5V 2T6'],['time_zone','Europe/Bucharest']])await rejected(`UPDATE public.listings SET ${field}=$1 WHERE id=$2`,[value,row.id]);
  check('browser location edits cannot retain a stale zone or spoof a new one');
  await db.query('UPDATE public.listings SET price=13,description=$1 WHERE id=$2',['Synthetic edit',row.id]);
  const current=(await db.query('SELECT price,time_zone FROM public.listings WHERE id=$1',[row.id])).rows[0];assert.equal(Number(current.price),13);assert.equal(current.time_zone,'America/Toronto');check('ordinary Host edits continue to work');
  await db.exec('RESET ROLE; SET LOCAL ROLE service_role;');assert.equal((await db.query('SELECT public.listing_timezone_assignment_ready() ready')).rows[0].ready,true);
  const saved=(await db.query(`INSERT INTO public.listings(host_id,title,address,price,spaces,lat,lng,time_zone) VALUES($1,'Synthetic server publish','Test address M5V 2T6',12,1,46.77,23.59,'Europe/Bucharest') RETURNING time_zone`,[host])).rows[0];assert.equal(saved.time_zone,'Europe/Bucharest');check('trusted server writes preserve the computed zone');
  await db.exec('RESET ROLE; ROLLBACK;');
 }catch(error){await db.exec('RESET ROLE; ROLLBACK;');throw error;}
}
