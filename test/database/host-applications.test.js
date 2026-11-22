import test,{before,after,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const HOST='10000000-0000-4000-8000-000000000001',OTHER='10000000-0000-4000-8000-000000000002',STAFF='10000000-0000-4000-8000-000000000003';
const REQUEST='20000000-0000-4000-8000-000000000001';
const HASH='a'.repeat(64),KEY='b'.repeat(64);
let db;
const payload=()=>({host_id:HOST,title:'Synthetic driveway',address:'123 Test Street, Toronto, Ontario M5V 2T6',price:4,description:'Synthetic parking instructions',features:[],spaces:1,photos:[`https://synthetic.invalid/storage/v1/object/public/listing-photos/${HOST}/30000000-0000-4000-8000-000000000001.jpg`],img:`https://synthetic.invalid/storage/v1/object/public/listing-photos/${HOST}/30000000-0000-4000-8000-000000000001.jpg`,spots:[{id:'0',forRent:true,bounds:null}],availability:{preset:'anytime'},lat:43.65,lng:-79.38,time_zone:'America/Toronto'});
async function rpc(action,actor,id=null,data={}){return (await db.query('select public.host_listing_application($1,$2::uuid,$3::uuid,$4::jsonb) as application',[action,actor,id,JSON.stringify(data)])).rows[0].application;}
async function denied(fn,code){await db.exec('savepoint denied');try{await assert.rejects(fn,error=>!code||error.code===code);}finally{await db.exec('rollback to savepoint denied; release savepoint denied');}}
async function draft(){return rpc('start',HOST,null,{propertyKey:KEY,address:payload().address,documentType:'tax',mime:'application/pdf',size:50});}
async function uploaded(){const a=await draft();await db.query("insert into storage.objects(bucket_id,name,metadata) values('host-ownership-documents',$1,$2::jsonb)",[a.document_path,JSON.stringify({size:50,mimetype:'application/pdf'})]);return rpc('confirm',HOST,a.id);}
async function submitted(){const a=await uploaded();await db.query("insert into storage.objects(bucket_id,name,metadata) values('listing-photos',$1,'{}')",[HOST+'/30000000-0000-4000-8000-000000000001.jpg']);return rpc('submit',HOST,a.id,{requestId:REQUEST,hash:HASH,propertyKey:KEY,listing:payload(),notification:{to:['info@myparkshare.ca'],subject:'Synthetic application',html:'Synthetic'}});}
before(async()=>{
 db=await PGlite.create();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema parkshare_private;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}',deleted_at timestamptz,banned_until timestamptz);
 create table public.profiles(id uuid primary key references auth.users(id),name text,email text,role text,stripe_account_id text,stripe_onboarding_complete boolean default false,stripe_charges_enabled boolean default false,stripe_payouts_enabled boolean default false);
 create table public.listings(id bigserial primary key,host_id uuid references public.profiles(id),title text,address text,price numeric,spaces integer,features text[],img text,lat double precision,lng double precision,created_at timestamptz default now(),spots jsonb,photos jsonb,description text,availability jsonb,time_zone text,is_paused boolean default false);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 grant usage on schema public,auth,storage,parkshare_private to service_role;grant all on all tables in schema public,auth,storage to service_role;grant usage on all sequences in schema public to service_role;
 insert into auth.users(id,email,email_confirmed_at) values('${HOST}','host@example.invalid',now()),('${OTHER}','other@example.invalid',now()),('${STAFF}','info@myparkshare.ca',now());
 insert into public.profiles(id,name,email,role,stripe_account_id,stripe_onboarding_complete,stripe_charges_enabled,stripe_payouts_enabled) values('${HOST}','Synthetic Host','host@example.invalid','host','acct_synthetic',true,true,true),('${OTHER}','Synthetic Other','other@example.invalid','host',null,false,false,false),('${STAFF}','Synthetic Reviewer','info@myparkshare.ca','driver',null,false,false,false);
 insert into public.listings(host_id,title,address)values('${HOST}','Legacy preserved','Legacy');`);
 await db.exec('begin;'+readFileSync(new URL('../../supabase/migrations/20261122163447_host_listing_applications_staff_approval.sql',import.meta.url),'utf8')+'commit;');
});
after(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});
test('new private document bucket and staff application tables are inaccessible to browser roles',async()=>{
 const b=(await db.query("select public from storage.buckets where id='host-ownership-documents'")).rows[0];assert.equal(b.public,false);
 for(const role of ['anon','authenticated']){const q=(await db.query(`select has_table_privilege('${role}','parkshare_private.host_listing_applications','SELECT') as table_read,has_function_privilege('${role}','public.host_listing_application(text,uuid,uuid,jsonb)','EXECUTE') as execute,has_table_privilege('${role}','public.listings','INSERT') as insert`)).rows[0];assert.deepEqual(q,{table_read:false,execute:false,insert:false});}
});
test('draft and submitted applications never create public listings; incomplete proof is rejected',async()=>{
 const a=await draft();await denied(()=>rpc('submit',HOST,a.id,{propertyKey:KEY,requestId:REQUEST,hash:HASH,listing:payload()}),'22023');
 assert.equal((await db.query('select count(*)::int as count from public.listings')).rows[0].count,1);
 const done=await submitted();assert.equal(done.status,'submitted');assert.equal(done.listing_id,null);assert.equal((await db.query('select count(*)::int as count from public.listings')).rows[0].count,1);
});
test('only the owner or trusted reviewers can access submitted applications; metadata spoofing does not grant approval',async()=>{
 const a=await submitted();await denied(()=>rpc('get',OTHER,a.id),'42501');
 await db.query("update auth.users set raw_user_meta_data='{"+'"parkshare_staff":true'+"}'::jsonb where id=$1",[OTHER]);
 await denied(()=>rpc('review',OTHER,a.id,{decision:'approved'}),'42501');assert.equal((await rpc('get',STAFF,a.id)).id,a.id);
 await db.query('update auth.users set email_confirmed_at=null where id=$1',[STAFF]);await denied(()=>rpc('review',STAFF,a.id,{decision:'approved'}),'42501');
});
test('submitted payload is immutable and retries return the same application',async()=>{
 const a=await submitted();const replay=await rpc('submit',HOST,a.id,{requestId:REQUEST,hash:HASH});assert.equal(replay.id,a.id);
 await denied(()=>rpc('submit',HOST,a.id,{requestId:REQUEST,hash:'c'.repeat(64)}),'P0061');
 assert.deepEqual((await rpc('get',HOST,a.id)).listing_payload,payload());
});
test('staff approval atomically publishes exactly once and preserves the approved details',async()=>{
 const a=await submitted();const first=await rpc('review',STAFF,a.id,{decision:'approved',note:'Reviewed synthetic proof'});const again=await rpc('review',STAFF,a.id,{decision:'approved'});
 assert.equal(first.listing_id,again.listing_id);assert.equal(first.reviewed_by,STAFF);const listing=(await db.query('select * from public.listings where id=$1',[first.listing_id])).rows[0];
 assert.equal(listing.host_application_id,a.id);assert.equal(listing.address,payload().address);assert.equal((await db.query('select count(*)::int as count from public.listings')).rows[0].count,2);
 await denied(()=>rpc('review',STAFF,a.id,{decision:'rejected',note:'Cannot reverse an approved listing'}),'P0072');
});
test('staff rejection needs a correction note and never publishes a listing',async()=>{
 const a=await submitted();await denied(()=>rpc('review',STAFF,a.id,{decision:'rejected',note:'short'}),'22023');
 const rejected=await rpc('review',STAFF,a.id,{decision:'rejected',note:'Upload a readable document showing the property address.'});assert.equal(rejected.status,'rejected');assert.equal(rejected.listing_id,null);
 await denied(()=>rpc('review',STAFF,a.id,{decision:'approved'}),'P0072');
});
test('Stripe readiness and approval are required even for privileged direct inserts',async()=>{
 const a=await submitted();await db.query('update public.profiles set stripe_payouts_enabled=false where id=$1',[HOST]);
 await denied(()=>rpc('review',STAFF,a.id,{decision:'approved'}),'P0074');
 await denied(()=>db.query('insert into public.listings(host_id,title,address)values($1,$2,$3)',[HOST,'Unreviewed','Synthetic']),'P0071');
});
test('notification queue is addressed only to info and claims cannot be double-acknowledged',async()=>{
 const a=await submitted();let jobs=(await db.query('select * from public.claim_host_application_notifications($1,5)',[a.id])).rows;assert.equal(jobs.length,1);
 const job=Object.values(jobs[0])[0];assert.deepEqual(job.payload.to,['info@myparkshare.ca']);assert.equal((await db.query('select * from public.claim_host_application_notifications($1,5)',[a.id])).rows.length,0);
 const q=await db.query('select public.finish_host_application_notification($1,$2,$3,null) as ok',[a.id,job.claim,'synthetic_provider_id']);assert.equal(q.rows[0].ok,true);
 assert.equal((await db.query('select public.finish_host_application_notification($1,$2,$3,null) as ok',[a.id,job.claim,'duplicate'])).rows[0].ok,false);
 assert.equal((await db.query('select * from public.claim_host_application_notifications($1,5)',[a.id])).rows.length,0);
});
test('existing listings stay editable while an approved property cannot be swapped',async()=>{
 await db.exec("update public.listings set description='Updated legacy description' where id=1");assert.equal((await db.query('select count(*)::int as count from public.listings')).rows[0].count,1);
 const a=await submitted(),approved=await rpc('review',STAFF,a.id,{decision:'approved'});
 await denied(()=>db.query('update public.listings set address=$1 where id=$2',['Different property',approved.listing_id]),'P0071');
});

// Exercise the HTTP handler against the real isolated database and simulated
// object storage/mail, never production accounts, documents or recipients.
async function apiHarness(){
 const {createHostApplicationsHandler,deliverHostApplicationNotifications}=await import('../../api/_host-applications.js');
 let actor=HOST,mailFailure=false;const files=new Map(),messages=[];
 const adapter={
  async rpc(name,args){
   await db.exec('savepoint api_rpc');
   try{
    let result;
    if(name==='host_listing_application')result=await db.query('select public.host_listing_application($1,$2::uuid,$3::uuid,$4::jsonb) as data',[args.p_action,args.p_actor_id,args.p_application_id,JSON.stringify(args.p_data)]);
    else if(name==='claim_host_application_notifications')result=await db.query('select * from public.claim_host_application_notifications($1,$2)',[args.p_application_id,args.p_limit]);
    else result=await db.query('select public.finish_host_application_notification($1,$2,$3,$4) as data',[args.p_id,args.p_claim,args.p_provider_id,args.p_error]);
    await db.exec('release savepoint api_rpc');return {data:name==='claim_host_application_notifications'?result.rows.map(row=>Object.values(row)[0]):result.rows[0]?.data,error:null};
   }catch(error){await db.exec('rollback to savepoint api_rpc;release savepoint api_rpc');return {data:null,error};}
  },
  from(table){assert.equal(table,'profiles');return {select(){return {eq(field,id){assert.equal(field,'id');const read=async()=>({data:(await db.query('select * from public.profiles where id=$1',[id])).rows[0],error:null});return {single:read,maybeSingle:read};}};},update(value){return {async eq(field,id){assert.equal(field,'id');const keys=Object.keys(value);await db.query('update public.profiles set '+keys.map((key,i)=>key+'=$'+(i+1)).join(',')+' where id=$'+(keys.length+1),[...Object.values(value),id]);return {error:null};}};}};},
  storage:{from(bucket){return {
   async createSignedUploadUrl(path){return {data:{token:'synthetic_upload_token',path},error:null};},
   async download(path){const blob=files.get(bucket+'/'+path);return {data:blob||null,error:blob?null:Error('missing')};},
   async createSignedUrl(path,expires){assert.equal(expires,bucket==='host-ownership-documents'?60:300);return files.has(bucket+'/'+path)?{data:{signedUrl:'https://private.invalid/'+path+'?token=synthetic'},error:null}:{data:null,error:Error('missing')};}
  };}}
 };
 const send=async(payload,options)=>{messages.push({payload,options});if(mailFailure)throw Error('synthetic provider failure');return {id:'synthetic_mail_id'};};
 const handler=createHostApplicationsHandler({db:adapter,stripe:{accounts:{retrieve:async()=>({details_submitted:true,charges_enabled:true,payouts_enabled:true})}},
  requireUser:async(req,res)=>{if(!actor){res.status(401).json({error:'Sign in required'});return null;}const user=(await db.query('select * from auth.users where id=$1',[actor])).rows[0];return {...user,app_metadata:user.raw_app_meta_data,user_metadata:user.raw_user_meta_data};},
  buildEmailPayload:input=>({from:'ParkShare <synthetic@example.invalid>',to:[input.to],subject:input.subject,html:input.html}),sendEmailPayload:send,getOrigin:()=> 'https://www.myparkshare.ca',storageUrl:'https://synthetic.invalid'});
 const call=async(body,query={})=>{const result={statusCode:200,setHeader(){},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}};await handler({method:body?'POST':'GET',body,query},result);return result;};
 const upload=async(mime='application/pdf')=>{
  const {propertyApplicationKey}=await import('../../api/_host-applications.js');
  const blob=new Blob(['%PDF-1.4\nSynthetic proof only. Not a real document.'],{type:mime});
  const started=await call({action:'start-document',...payload(),documentType:'tax',mime,size:blob.size});assert.equal(started.statusCode,201,JSON.stringify(started.body));
  const id=started.body.applicationId,path=started.body.path;
  files.set('host-ownership-documents/'+path,blob);
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('host-ownership-documents',$1,$2::jsonb)",[path,JSON.stringify({size:blob.size,mimetype:mime})]);
  const confirmed=await call({action:'confirm-document',applicationId:id});assert.equal(confirmed.statusCode,200,JSON.stringify(confirmed.body));
  assert.equal((await rpc('get',HOST,id)).property_key,propertyApplicationKey(payload()));
  const photoPath=HOST+'/30000000-0000-4000-8000-000000000001.jpg';files.set('listing-photos/'+photoPath,new Blob([new Uint8Array([255,216,255,224])],{type:'image/jpeg'}));
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('listing-photos',$1,'{}')",[photoPath]);
  return id;
 };
 return {call,upload,messages,adapter,setActor:id=>{actor=id;},failMail:value=>{mailFailure=value;},retry:()=>deliverHostApplicationNotifications(adapter,send),files};
}
test('HTTP: completed Host application emails only the approval inbox and stays unpublished until staff approval',async()=>{
 const {createAvailabilityPreset}=await import('../../src/lib/listingAvailability.js');
 const h=await apiHarness(),id=await h.upload(),body={...payload(),availability:createAvailabilityPreset('anytime','America/Toronto'),action:'submit',applicationId:id,requestId:REQUEST};
 const submitted=await h.call(body);assert.equal(submitted.statusCode,201,JSON.stringify(submitted.body));assert.equal(submitted.body.application.status,'submitted');
 assert.equal((await db.query('select count(*)::int as count from public.listings')).rows[0].count,1);assert.equal(h.messages.length,1);assert.deepEqual(h.messages[0].payload.to,['info@myparkshare.ca']);assert.match(h.messages[0].payload.html,/\/host-applications\?application=/);assert.equal(h.messages[0].payload.attachments,undefined);
 h.setActor(OTHER);assert.equal((await h.call({action:'review',id,decision:'approved'})).statusCode,403);assert.equal((await h.call(null,{id})).statusCode,403);
 h.setActor(STAFF);const approved=await h.call({action:'review',id,decision:'approved',note:'Synthetic review approved'});assert.equal(approved.statusCode,200,JSON.stringify(approved.body));assert.equal(approved.body.application.status,'approved');
 const repeat=await h.call({action:'review',id,decision:'approved'});assert.equal(repeat.body.application.listing_id,approved.body.application.listing_id);assert.equal((await db.query('select count(*)::int as count from public.listings')).rows[0].count,2);
});
test('HTTP: failed review email leaves a durable application and retry reuses the exact payload and key',async()=>{
 const {createAvailabilityPreset}=await import('../../src/lib/listingAvailability.js');const h=await apiHarness(),id=await h.upload();h.failMail(true);
 const body={...payload(),availability:createAvailabilityPreset('anytime','America/Toronto'),action:'submit',applicationId:id,requestId:REQUEST};
 assert.equal((await h.call(body)).statusCode,201);assert.equal((await h.call(body)).statusCode,200);assert.equal(h.messages.length,1);
 await db.query("update parkshare_private.host_listing_applications set notification_next_attempt_at=now()-interval '1 minute' where id=$1",[id]);h.failMail(false);assert.equal((await h.retry()).sent,1);assert.deepEqual(h.messages[0],h.messages[1]);
});
test('HTTP: document URLs require ownership or verified staff access and only last one minute',async()=>{
 const h=await apiHarness(),id=await h.upload();h.setActor(OTHER);assert.equal((await h.call(null,{id,document:'1'})).statusCode,403);
 h.setActor(HOST);const own=await h.call(null,{id,document:'1'});assert.equal(own.statusCode,200);assert.match(own.body.url,/private.invalid/);
 h.setActor(null);assert.equal((await h.call(null,{id,document:'1'})).statusCode,401);
});
test('HTTP: a durable validation rejection permits photo cleanup, then a corrected new request can be submitted',async()=>{
 const {createAvailabilityPreset}=await import('../../src/lib/listingAvailability.js');const h=await apiHarness(),id=await h.upload();
 const bad={...payload(),availability:createAvailabilityPreset('anytime','America/Toronto'),price:0,action:'submit',applicationId:id,requestId:REQUEST};
 const rejected=await h.call(bad);assert.equal(rejected.statusCode,400);assert.equal(rejected.body.safeToDiscard,true);assert.equal((await h.call(bad)).body.safeToDiscard,true);
 const good={...bad,price:4,requestId:'20000000-0000-4000-8000-000000000002'};assert.equal((await h.call(good)).statusCode,201);assert.equal((await h.call({...good,price:5})).statusCode,409);
});
