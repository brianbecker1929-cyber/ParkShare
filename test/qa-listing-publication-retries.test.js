import test from 'node:test';
import assert from 'node:assert/strict';
import {createListingPublication} from '../src/lib/listingPublicationAttempt.js';
import {listingPublicationIdentity} from '../api/_listing-publication.js';
import {publishHostListing} from '../src/lib/hostListingPublish.js';
const HOST='00000000-0000-4000-8000-000000000081',OTHER='00000000-0000-4000-8000-000000000082';
const ID='10000000-0000-4000-8000-000000000011';
const payload=urls=>({address:'Synthetic address',price:12,spots:[{forRent:true}],photos:urls});
const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic',user:{id:HOST}}}})}};
function fixture(fetcher){
 const records=new Map(),calls={uploads:0,removes:[],requests:[]};const storage={getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
 const opts={hostId:HOST,client,storage,randomId:()=>ID,upload:async()=>{calls.uploads++;return {urls:['https://synthetic.invalid/photo.webp'],paths:[HOST+'/photo.webp']};},remove:async(c,paths)=>calls.removes.push(paths),fetcher:async(url,options)=>{calls.requests.push(JSON.parse(options.body));return fetcher(url,options);}};
 return {opts,storage,calls,records,create:()=>createListingPublication(opts)};
}
test('lost response, repeated click and reload reuse one exact payload and one photo upload',async()=>{
 let n=0;const f=fixture(async()=>{if(++n===1)throw Error('response lost after commit');return Response.json({listing:{id:55,timeZone:'America/Toronto',replayed:true}});});
 const draft=f.create();const one=draft.publish(payload,[{}]),two=draft.publish(payload,[{}]);assert.equal(one,two);await assert.rejects(one,/Check your Host Dashboard/);assert.equal(draft.pending,true);
 const recovered=f.create();const result=await recovered.publish(()=>{throw Error('must not rebuild or upload');},[]);
 assert.equal(result.id,55);assert.equal(result.address,'Synthetic address');assert.equal(result.spaces,1);assert.equal(f.calls.uploads,1);assert.equal(f.calls.removes.length,0);assert.deepEqual(f.calls.requests[0],f.calls.requests[1]);assert.equal(recovered.pending,false);assert.equal(f.records.size,0);
});
test('only a durable server rejection permits photo cleanup and a fresh editable attempt',async()=>{
 const f=fixture(async()=>Response.json({error:'Invalid dates',safeToDiscard:true},{status:400}));const draft=f.create();await assert.rejects(()=>draft.publish(payload,[{}]),/Invalid dates/);assert.equal(draft.pending,false);assert.equal(f.calls.removes.length,1);assert.equal(f.records.size,0);
});
test('auth, conflict, gateway and malformed response failures retain the original receipt and photos',async()=>{
 for(const response of [()=>Response.json({error:'Sign in'},{status:401}),()=>Response.json({error:'Different details'},{status:409}),()=>Response.json({error:'Unknown outcome'},{status:503}),()=>new Response('<html>gateway</html>',{status:502}),()=>Response.json({error:'Unconfirmed'},{status:200}),()=>Response.json({error:'Invalid request'},{status:400})]){
  const f=fixture(async()=>response()),draft=f.create();await assert.rejects(()=>draft.publish(payload,[{}]));assert.equal(draft.pending,true);assert.equal(f.calls.removes.length,0);assert.equal(f.records.size,1);
 }
});
test('deleted publication clears recovery without deleting photos again or recreating it',async()=>{
 const f=fixture(async()=>Response.json({error:'Already deleted',publicationDeleted:true},{status:410})),draft=f.create();await assert.rejects(()=>draft.publish(payload,[{}]),/Already deleted/);assert.equal(draft.pending,false);assert.equal(f.calls.removes.length,0);
});
test('receipt persistence must succeed before publishing and contains no credentials or photo blobs',async()=>{
 const f=fixture(async()=>{throw Error('must not be called');});f.opts.storage={...f.storage,setItem:()=>{throw Error('Storage full');}};await assert.rejects(()=>f.create().publish(payload,[{file:'photo blob'}]),/Storage full/);assert.equal(f.calls.requests.length,0);assert.equal(f.calls.removes.length,1);
 const g=fixture(async()=>{throw Error('lost');});await assert.rejects(()=>g.create().publish(payload,[{file:'photo blob'}]));const saved=[...g.records.values()][0];assert.ok(!saved.includes('access_token'));assert.ok(!saved.includes('photo blob'));assert.ok(!saved.includes('synthetic\"'));
});
test('account switch during upload cannot publish the original Host draft with another token',async()=>{
 const f=fixture(async()=>{throw Error('must not call');});f.opts.client={auth:{getSession:async()=>({data:{session:{access_token:'other',user:{id:OTHER}}}})}};const d=f.create();await assert.rejects(()=>d.publish(payload,[{}]),/original Host/);assert.equal(f.calls.requests.length,0);assert.equal(d.pending,true);assert.equal(f.calls.removes.length,0);
 const other=createListingPublication({...f.opts,hostId:OTHER});assert.equal(other.pending,false);
});
test('a corrupt saved receipt blocks a new publication instead of silently losing the old request',async()=>{
 const f=fixture(async()=>{throw Error('not called');});f.storage.setItem('parkshare:listing-publication:'+HOST,'invalid json');const draft=f.create();assert.equal(draft.pending,true);await assert.rejects(()=>draft.publish(payload,[{}]),/could not be loaded/);assert.equal(f.calls.uploads,0);
});
test('publication identity is canonical, bound to the full payload, and rejects missing request IDs',()=>{
 const one={requestId:ID,title:'One',spots:[{forRent:true,bounds:null}]};const two={spots:[{bounds:null,forRent:true}],title:'One',requestId:ID};assert.deepEqual(listingPublicationIdentity(one),listingPublicationIdentity(two));assert.notEqual(listingPublicationIdentity({...one,title:'Two'}).hash,listingPublicationIdentity(one).hash);assert.throws(()=>listingPublicationIdentity({}),RangeError);
});
test('a token expiry on resume never authorizes photo cleanup',async()=>{
 await assert.rejects(()=>publishHostListing({auth:{getSession:async()=>({data:{session:null}})}},{requestId:ID}),e=>!e.cleanupAllowed);
});

// Exercise the actual HTTP handler with an opaque service RPC, without a hosted write.
import {readFileSync} from 'node:fs';
const routeCode=readFileSync(new URL('../api/host-listings.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');
async function routeResult({rpc,resolve=()=>{throw Error('must replay before timezone lookup');},validate=()=>{throw new RangeError('Past date');}}){
 let code=200,body;const handler=new Function('jsonMethod','requireUser','supabaseAdmin','resolveListingTimeZone','hostListingRow','listingPublicationIdentity','process',routeCode)(()=>true,async()=>({id:HOST}),{from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:'host'}})})})}),rpc},resolve,validate,listingPublicationIdentity,{env:{SUPABASE_URL:'https://synthetic.invalid'}});
 await handler({method:'POST',body:{...payload(['https://synthetic.invalid/a.webp']),requestId:ID}},{setHeader(){},status(n){code=n;return this;},json(value){body=value;return this;}});return {code,body};
}
test('HTTP replay returns committed publication without revalidating now-past dates or calling geographic lookup',async()=>{
 const result=await routeResult({rpc:async(name,args)=>{assert.equal(name,'publish_host_listing');assert.equal(args.p_host_id,HOST);assert.equal(args.p_listing,null);return {data:{id:55,timeZone:'America/Toronto',replayed:true}};}});assert.equal(result.code,200);assert.equal(result.body.listing.id,55);
});
test('HTTP conflict and deletion results cannot authorize cleanup or reinsertion',async()=>{
 for(const [code,status] of [['P0061',409],['P0062',410]]){const result=await routeResult({rpc:async()=>({error:{code}})});assert.equal(result.code,status);assert.notEqual(result.body.safeToDiscard,true);}
});
test('validation rejection is committed before cleanup is allowed; a racing success is returned instead',async()=>{
 for(const saved of [{rejected:true,error:'Past date'},{id:55,timeZone:'America/Toronto',replayed:true}]){
  let calls=0;const result=await routeResult({resolve:()=> 'America/Toronto',rpc:async(name,args)=>{calls++;if(calls===1)return {data:null};assert.equal(args.p_rejection,'Past date');return {data:saved};}});assert.equal(calls,2);assert.equal(result.code,saved.rejected?400:200);assert.equal(result.body.safeToDiscard===true,Boolean(saved.rejected));
 }
});
