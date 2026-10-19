import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAvailabilityPreset} from '../src/lib/listingAvailability.js';
export const listingPublicationMigration=new URL('../supabase/migrations/20261019220539_listing_publication_retries.sql',import.meta.url);
const HOST='00000000-0000-4000-8000-000000000091',OTHER='00000000-0000-4000-8000-000000000092',DRIVER='00000000-0000-4000-8000-000000000093';
const ID=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const HASH='a'.repeat(64);
const row=host=>({host_id:host,title:'Synthetic publication',address:'Test Toronto ON M5V 2T6',price:12,description:'Synthetic only',availability:createAvailabilityPreset('anytime','America/Toronto'),spaces:1,features:[],photos:[],img:null,spots:[{forRent:true}],lat:43.65,lng:-79.38,time_zone:'America/Toronto'});
const sql='SELECT public.publish_host_listing($1,$2,$3,$4::jsonb,$5) result';
const args=(host,id,listing=null,hash=HASH,rejection=null)=>[host,id,hash,listing?JSON.stringify(listing):null,rejection];
async function seed(db){
 await db.query(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ($1,'publication-host@example.invalid','{"role":"host"}'),($2,'publication-other@example.invalid','{"role":"host"}'),($3,'publication-driver@example.invalid','{"role":"driver"}')`,[HOST,OTHER,DRIVER]);
}
export async function runListingPublicationProbe(db,report={checks:[]},connect){
 const check=name=>report.checks.push({name:'listing publication: '+name,status:'passed'});
 const digest=async()=> (await db.query("SELECT md5(coalesce(string_agg(to_jsonb(b)::text,'|' ORDER BY id),'')) digest FROM public.bookings b")).rows[0].digest;
 const before=await digest();await db.exec(await readFile(listingPublicationMigration,'utf8'));assert.equal(await digest(),before);check('additive migration preserves booking history');
 for(const role of ['anon','authenticated']){
  assert.equal((await db.query("SELECT has_function_privilege($1,'public.publish_host_listing(uuid,uuid,text,jsonb,text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_table_privilege($1,'parkshare_private.listing_publications','SELECT') allowed",[role])).rows[0].allowed,false);
 }
 check('browser roles cannot read the ledger or invoke publication');
 await db.exec('BEGIN;');
 try{
  await seed(db);
  await db.exec(`CREATE FUNCTION pg_temp.reject_publication_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.request_id='${ID(5)}'::uuid THEN RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='Synthetic receipt write failure'; END IF;
    RETURN NEW; END; $$;
    CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON parkshare_private.listing_publications FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_publication_receipt();`);
  await db.exec('SET LOCAL ROLE service_role;');
  assert.equal((await db.query('SELECT public.listing_publication_ready() ready')).rows[0].ready,true);check('service-only readiness passes');
  const call=async values=>(await db.query(sql,values)).rows[0].result;
  async function denied(values,code){await db.exec('SAVEPOINT rejected;');try{await assert.rejects(()=>call(values),e=>e.code===code);}finally{await db.exec('ROLLBACK TO SAVEPOINT rejected;');}}
  assert.equal(await call(args(HOST,ID(1))),null);
  const first=await call(args(HOST,ID(1),row(HOST)));assert.equal(first.replayed,false);
  assert.deepEqual(await call(args(HOST,ID(1))),{...first,replayed:true});
  assert.equal((await db.query('SELECT count(*)::int n FROM public.listings WHERE host_id=$1',[HOST])).rows[0].n,1);check('lost response replay returns one original listing');
  await denied(args(HOST,ID(1),row(HOST),'b'.repeat(64)),'P0061');check('changed payload cannot reuse a committed request ID');
  const other=await call(args(OTHER,ID(1),row(OTHER)));assert.notEqual(other.id,first.id);check('same ID is isolated by authenticated Host identity');
  await denied(args(DRIVER,ID(2),row(DRIVER)),'42501');await denied(args(HOST,ID(2),row(OTHER)),'22023');check('Driver and forged owner calls are denied');
  // Real constraint failure rolls back both the attempted insert and receipt.
  await denied(args(HOST,ID(3),{...row(HOST),price:-1}),'23514');
  assert.equal((await db.query('SELECT count(*)::int n FROM parkshare_private.listing_publications WHERE request_id=$1',[ID(3)])).rows[0].n,0);
  assert.ok((await call(args(HOST,ID(3),row(HOST)))).id);check('failed insert leaves no false success receipt and can be retried');
  const countBefore=(await db.query('SELECT count(*)::int n FROM public.listings')).rows[0].n;
  await denied(args(HOST,ID(5),row(HOST)),'P0099');
  assert.equal((await db.query('SELECT count(*)::int n FROM public.listings')).rows[0].n,countBefore);
  assert.equal((await db.query('SELECT count(*)::int n FROM parkshare_private.listing_publications WHERE request_id=$1',[ID(5)])).rows[0].n,0);
  check('receipt write failure rolls back the listing insert atomically');
  const rejection=await call(args(HOST,ID(4),null,HASH,'Invalid future date'));assert.equal(rejection.rejected,true);
  assert.deepEqual(await call(args(HOST,ID(4),row(HOST))),rejection);check('durable rejection blocks racing inserts before photo cleanup');
  assert.equal((await call(args(HOST,ID(1),null,HASH,'Now expired'))).id,first.id);check('committed success wins over a later date-validation rejection');
  // Existing Host deletion queue remains responsible for cleanup.
  await db.query('DELETE FROM public.listings WHERE id=$1',[first.id]);
  await denied(args(HOST,ID(1),row(HOST)),'P0062');check('deleted listings cannot be resurrected by replay');
  await db.exec('RESET ROLE; ROLLBACK;');
 }catch(error){await db.exec('ROLLBACK;');await db.exec('RESET ROLE;');throw error;}
 assert.equal(await digest(),before);
 if(connect)await concurrency(db,check,connect);
}
async function concurrency(db,check,connect){
 // Only a fresh disposable database invokes this probe; never a hosted QA URL.
 await seed(db);const a=await connect(),b=await connect();let waiting;
 try{
  for(const [index,firstRejected,secondRejected] of [[10,false,false],[11,true,false],[12,false,true]]){
   await a.query('BEGIN; SET LOCAL ROLE service_role;');await b.query("BEGIN; SET LOCAL ROLE service_role; SET LOCAL statement_timeout='5s';");
   const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   const first=(await a.query(sql,args(HOST,ID(index),firstRejected?null:row(HOST),HASH,firstRejected?'Rejected date':null))).rows[0].result;
   waiting=b.query(sql,args(HOST,ID(index),secondRejected?null:row(HOST),HASH,secondRejected?'Rejected date':null));waiting.catch(()=>{});
   let blocked=false;
   for(let i=0;i<40;i++){
    blocked=(await db.query("SELECT wait_event='advisory' blocked FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.blocked;
    if(blocked)break;await db.query('SELECT pg_sleep(0.02)');
   }
   assert.equal(blocked,true,'second connection must wait for the first publication transaction');
   await a.query('COMMIT;');const replay=(await waiting).rows[0].result;await b.query('COMMIT;');
   if(firstRejected)assert.deepEqual(replay,first);
   else{assert.equal(replay.id,first.id);assert.equal(replay.replayed,true);}
   check('native concurrent '+(firstRejected?'rejection blocks insertion':secondRejected?'success prevents cleanup rejection':'requests create one listing'));
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM public.listings WHERE host_id=$1',[HOST])).rows[0].n,2);
 }finally{
  await a.query('ROLLBACK;');await b.query('ROLLBACK;');await a.end();await b.end();
  await db.query('DELETE FROM public.listings WHERE host_id IN ($1,$2)',[HOST,OTHER]);
  await db.query('DELETE FROM auth.users WHERE id IN ($1,$2,$3)',[HOST,OTHER,DRIVER]);
 }
}
