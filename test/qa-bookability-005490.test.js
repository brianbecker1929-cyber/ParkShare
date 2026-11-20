import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cachedHostBookingStatus,normalizeBookingStatus} from '../src/lib/bookingReadiness.js';
import {publicListingBookability,createAccountBookabilityReader} from '../api/_listing-bookability.js';
import {publicDiscoveryListing} from '../src/lib/publicDiscovery.js';
const host={role:'host',stripe_account_id:'acct_private',stripe_onboarding_complete:true,stripe_charges_enabled:true,stripe_payouts_enabled:true};
const account=id=>({id,details_submitted:true,charges_enabled:true,payouts_enabled:true});
const tick=()=>new Promise(r=>setImmediate(r));
test('BUG-005490 cached readiness requires all three strict flags and a Host account',()=>{
 assert.equal(cachedHostBookingStatus(host),'ready');
 for(const field of ['stripe_onboarding_complete','stripe_charges_enabled','stripe_payouts_enabled']){assert.equal(cachedHostBookingStatus({...host,[field]:false}),'not_ready');for(const value of [undefined,'true',1,null])assert.equal(cachedHostBookingStatus({...host,[field]:value}),'unknown');}
 for(const value of [null,{}, {...host,role:'driver'},{...host,stripe_account_id:null}])assert.equal(cachedHostBookingStatus(value),'not_ready');
 for(const value of [true,'READY',{},undefined,'checking'])assert.equal(normalizeBookingStatus(value),'unknown');
});
test('bounded discovery status lookup returns only enums for requested IDs and fails to unknown',async()=>{
 let ids;const admin={from:table=>{assert.equal(table,'listings');return {select:()=>({in:async(_,value)=>{ids=value;return {data:[{id:1,profiles:host},{id:2,profiles:[{...host,stripe_payouts_enabled:false}]},{id:3,profiles:[]},{id:4,profiles:null},{id:999,profiles:host}]};}})};}};
 const result=await publicListingBookability(admin,[1,1,2,3,4,...Array.from({length:80},(_,i)=>i+5),NaN,-1]);assert.equal(ids.length,50);assert.equal(result.size,50);assert.equal(result.get(1),'ready');assert.equal(result.get(2),'not_ready');assert.equal(result.get(3),'unknown');assert.equal(result.get(4),'not_ready');assert.equal(result.has(999),false);assert.doesNotMatch(JSON.stringify([...result]),/acct_|stripe_|host/);
 for(const broken of [{},{from:()=>{throw Error('private');}},{from:()=>({select:()=>({in:async()=>({error:{}})})})}])assert.equal((await publicListingBookability(broken,[1])).get(1),'unknown');
 assert.equal((await publicListingBookability(admin,[])).size,0);
});
test('provider reader coalesces calls, expires cached status and bounds retained accounts',async()=>{
 let time=0,calls=0,release;const stripe={accounts:{retrieve:id=>{calls++;return new Promise(r=>{release=()=>r(account(id));});}}};const read=createAccountBookabilityReader(stripe,{now:()=>time,ttlMs:10,maxEntries:2});
 const first=read('A'),second=read('A');assert.equal(first,second);await tick();assert.equal(calls,1);release();assert.equal(await first,'ready');assert.equal(await read('A'),'ready');assert.equal(calls,1);time=11;const expired=read('A');await tick();release();await expired;assert.equal(calls,2);
 for(const id of ['B','C','A']){const work=read(id);await tick();release();await work;}assert.equal(calls,5);
});
test('provider reader never caches errors or treats malformed/wrong-account responses as ready',async()=>{
 for(const response of [null,account('other'),{id:'A',charges_enabled:true}, {...account('A'),payouts_enabled:'true'}]){let calls=0;const read=createAccountBookabilityReader({accounts:{retrieve:async()=>{calls++;return response;}}});await assert.rejects(read('A'));await assert.rejects(read('A'));assert.equal(calls,2);}
 for(const response of [{...account('A'),payouts_enabled:false},{id:'A',deleted:true}])assert.equal(await createAccountBookabilityReader({accounts:{retrieve:async()=>response}})('A'),'not_ready');
 let fail=true;const read=createAccountBookabilityReader({accounts:{retrieve:async()=>{if(fail)throw Error('offline');return account('A');}}});await assert.rejects(read('A'));fail=false;assert.equal(await read('A'),'ready');
});
const endpoint=(await readFile(new URL('../api/listing-bookability.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');
function fixture({missing=false,role='host',linked=true,dbError=false,providerError=false,status='ready',paused=false}={}){
 const calls=[];const admin={from:table=>({select:fields=>({eq:(key,value)=>({maybeSingle:async()=>{calls.push({table,fields,key,value});if(dbError)return {error:{code:'PRIVATE'}};return {data:table==='listings'?(missing?null:{host_id:'private-host',is_paused:paused}):{role,stripe_account_id:linked?'acct_private':null}};}})})})};
 const handler=new Function('jsonMethod','supabaseAdmin','stripe','createAccountBookabilityReader','console',endpoint)((req,res,method)=>{if(req.method===method)return true;res.setHeader('Allow',method);res.status(405).json({error:'Method not allowed'});return false;},admin,{},()=>async id=>{calls.push({account:id});if(providerError)throw Error('PRIVATE');return status;},{warn(){}});
 return {calls,run:async(raw='7',method='GET')=>{const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(b){this.body=b;return this;}};await handler({method,query:{listingId:raw}},res);return res;}};
}
test('public detail endpoint uses server-owned Host identity and discloses only the readiness enum',async()=>{
 for(const status of ['ready','not_ready']){const f=fixture({status}),res=await f.run();assert.equal(res.code,200);assert.deepEqual(res.body,{bookingStatus:status});assert.equal(res.headers['Cache-Control'],'no-store');assert.deepEqual(f.calls,[{table:'listings',fields:'host_id,is_paused',key:'id',value:7},{table:'profiles',fields:'role,stripe_account_id',key:'id',value:'private-host'},{account:'acct_private'}]);}
 for(const options of [{role:'driver'},{linked:false}]){const f=fixture(options);assert.deepEqual((await f.run()).body,{bookingStatus:'not_ready'});assert.equal(f.calls.length,2);}
});
test('invalid, missing and unsupported requests never query Stripe; DB/provider failures fail closed',async()=>{
 for(const raw of [undefined,'0','-1','1e2','01','1.5','9007199254740992',['7']]){const f=fixture();assert.equal((await f.run(raw===undefined?null:raw)).code,400);assert.equal(f.calls.length,0);}
 const absent=fixture({missing:true});assert.equal((await absent.run()).code,404);assert.equal(absent.calls.length,1);
 for(const method of ['POST','PATCH','DELETE','HEAD']){const f=fixture(),res=await f.run('7',method);assert.equal(res.code,405);assert.equal(res.headers.Allow,'GET');assert.equal(f.calls.length,0);}
 for(const options of [{dbError:true},{providerError:true}]){const res=await fixture(options).run();assert.equal(res.code,503);assert.equal(res.body.bookingStatus,'unknown');assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE|acct_|host_id/);}
});
test('public projection whitelists booking status without exposing Host account information',()=>{
 for(const status of ['ready','not_ready','invalid',undefined]){const row=publicDiscoveryListing({id:7,price:5,spaces:1,lat:43.6,lng:-79.4,bookingStatus:status,...host});assert.equal(row.bookingStatus,normalizeBookingStatus(status));assert.doesNotMatch(JSON.stringify(row),/acct_private|stripe_|onboarding/);}
});

test('BUG-005445 a paused detail returns its public status before private profile or Stripe reads',async()=>{
 const f=fixture({paused:true}),res=await f.run();assert.equal(res.code,200);assert.deepEqual(res.body,{bookingStatus:'paused'});assert.equal(f.calls.length,1);assert.equal(normalizeBookingStatus('paused'),'paused');
 const admin={from:()=>({select:()=>({in:async()=>({data:[{id:7,is_paused:true,profiles:host}]})})})};assert.equal((await publicListingBookability(admin,[7])).get(7),'paused');assert.equal(publicDiscoveryListing({id:7,bookingStatus:'paused'}).bookingStatus,'paused');
});
