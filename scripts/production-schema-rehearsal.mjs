// Local-only support. No hosted database or external provider calls.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {restoreSnapshot} from './qa-schema-rehearsal.mjs';

export function assertProductionRehearsalUrl(raw) {
  const u=new URL(raw);
  assert.ok(['postgres:','postgresql:'].includes(u.protocol),'PostgreSQL URL required');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname),'Only an isolated LOCAL database is allowed');
  assert.equal(u.pathname,'/parkshare_production_rehearsal','Dedicated disposable database name required');
  assert.equal(u.username,'postgres','Local fixture restore requires the isolated postgres role');
  assert.equal(u.search,'','Connection override options are forbidden');
  assert.equal(u.hash,'','Connection fragments are forbidden');
  return {host:u.hostname==='[::1]'?'::1':u.hostname,port:Number(u.port||5432),database:'parkshare_production_rehearsal',user:'postgres',password:decodeURIComponent(u.password),ssl:false,options:'',connectionTimeoutMillis:5000};
}

export const productionFixtureUrl=new URL('../test/database/fixtures/production-schema-nov11.json',import.meta.url);
export async function restoreProductionSnapshot(db) {
  const snapshot=JSON.parse(await readFile(productionFixtureUrl,'utf8'));
  for(const section of [snapshot.structure,snapshot.code,snapshot.permissions,snapshot.extra])
    for(const key of Object.keys(section))if(section[key]===null)section[key]=[];
  await db.exec('DROP SCHEMA IF EXISTS parkshare_private CASCADE;');
  await restoreSnapshot(db,snapshot);
  return snapshot;
}

export const syntheticPeople={host:'00000000-0000-4000-8000-00000000a101',driver:'00000000-0000-4000-8000-00000000a102',other:'00000000-0000-4000-8000-00000000a103'};
export async function seedProductionShape(db,{duplicateReviews=false}={}) {
  const {host,driver,other}=syntheticPeople;
  for(const [id,role] of [[host,'host'],[driver,'driver'],[other,'driver']])await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,jsonb_build_object('name','Synthetic production rehearsal','role',$3::text))",[id,role+id.slice(-4)+'@example.invalid',role]);
  const listing=(await db.query("INSERT INTO public.listings(host_id,title,address,price,spaces,lat,lng) VALUES($1,'Synthetic legacy listing','Preserved historical address',900,4,43.65,-79.38) RETURNING id",[host])).rows[0].id;
  const ids=[];
  for(let i=0;i<29;i++) {
    const r=await db.query(`INSERT INTO public.bookings(listing_id,renter_id,hours,total,subtotal,service_fee,status,booking_date,start_hour,paid_at,spot_label,stripe_connected_account_id,stripe_payment_intent_id,stripe_charge_id,stripe_checkout_session_id,reminder_halfway_sent_at,reminder_ending_sent_at,confirmation_email_sent_at,stripe_refund_id,refund_amount,refund_status)
      VALUES($1,$2,2,100,85,15,$3,$4,14,'2026-10-17T12:00Z',$5,'acct_prod_fixture',$6,$7,$8,$9,$9,$9,$10,$11,$12) RETURNING id`,
      [listing,i%2?driver:other,i===0?'cancelled':'confirmed',`2026-12-${String(i+1).padStart(2,'0')}`,String.fromCharCode(65+i%4),'pi_fixture_'+i,'ch_fixture_'+i,'cs_fixture_'+i,i%2?'2026-10-17T13:00Z':null,i===0?'re_legacy_fixture':null,i===0?20:null,i===0?'succeeded':null]);
    ids.push(r.rows[0].id);
  }
  const extensions=[];
  for(let i=0;i<2;i++)extensions.push((await db.query("INSERT INTO public.booking_extensions(booking_id,added_hours,added_amount,status,paid_at,stripe_connected_account_id,stripe_payment_intent_id,stripe_charge_id) VALUES($1,1,12,'paid','2026-10-18T12:00Z','acct_prod_fixture',$2,$3) RETURNING id",[ids[i+1],'pi_extension_'+i,'ch_extension_'+i])).rows[0].id);
  const messages=[];
  for(let i=0;i<7;i++)messages.push((await db.query("INSERT INTO public.messages(listing_id,sender_id,recipient_id,text) VALUES($1,$2,NULL,'Synthetic unaddressed historical message') RETURNING id",[listing,driver])).rows[0].id);
  await db.query("INSERT INTO public.messages(listing_id,sender_id,recipient_id,text) VALUES($1,$2,$3,'Synthetic addressed historical message')",[listing,driver,host]);
  await db.query("INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES($1,$2,5,'Synthetic existing review')",[listing,driver]);
  if(duplicateReviews)await db.query("INSERT INTO public.reviews(listing_id,user_id,rating,text) VALUES($1,$2,4,'Synthetic duplicate review')",[listing,driver]);
  return {listing,bookings:ids,extensions,messages,...syntheticPeople};
}
