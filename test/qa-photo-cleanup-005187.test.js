import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {cleanupListingPhotos} from '../api/_listing-photo-cleanup.js';
import {listingDeletionFailureMessage} from '../src/lib/listingDeletion.js';
const host='00000000-0000-4000-8000-000000000041';
const path=`${host}/00000000-0000-4000-8000-000000000051.jpg`;
function fake({jobs=[{host_id:host,object_path:path}],removeError=null,ackError=null}={}){
 const trace=[];const admin={rpc:async(name,args)=>{trace.push(['rpc',name,args]);return {data:jobs};},storage:{from:bucket=>({remove:async paths=>{trace.push(['storage',bucket,paths]);return {error:removeError};}})},from:table=>({update:values=>({in:async(field,paths)=>{trace.push(['retry',values,paths]);return {};}}),delete:()=>({in:async(field,paths)=>{trace.push(['ack',table,paths]);return {error:ackError};}})})};return {admin,trace};
}
test('successful Storage deletion acknowledges jobs only after remove succeeds',async()=>{
 const h=fake();assert.deepEqual(await cleanupListingPhotos(h.admin,{listingId:52}),{processed:1,pending:false});
 assert.deepEqual(h.trace.map(x=>x[0]),['rpc','storage','ack']);assert.deepEqual(h.trace[1],['storage','listing-photos',[path]]);
 assert.equal(h.trace[0][2].target_listing_id,52);
});
test('Storage outage keeps jobs retryable without false acknowledgement',async()=>{
 const h=fake({removeError:{message:'outage'}});assert.deepEqual(await cleanupListingPhotos(h.admin,{now:0}),{processed:0,pending:true});
 assert.deepEqual(h.trace.map(x=>x[0]),['rpc','storage','retry']);assert.equal(h.trace[2][1].next_attempt_at,'1970-01-01T01:00:00.000Z');
});
test('acknowledgement outage leaves the idempotent job for another pass',async()=>{
 const h=fake({ackError:Error('lost DB response')});await assert.rejects(cleanupListingPhotos(h.admin));assert.equal(h.trace[1][0],'storage');
});
test('empty or shared-photo batches do not call Storage',async()=>{
 const h=fake({jobs:[]});assert.deepEqual(await cleanupListingPhotos(h.admin),{processed:0,pending:false});assert.equal(h.trace.length,1);
});
test('tampered paths and other-host paths cannot reach privileged Storage',async()=>{
 for(const object_path of ['../another/photo.jpg','https://outside.invalid/photo.jpg',path.replace(host,'00000000-0000-4000-8000-000000000042')]){
  const h=fake({jobs:[{host_id:host,object_path}]});await assert.rejects(cleanupListingPhotos(h.admin));assert.equal(h.trace.length,1);
 }
});
const deleteSource=readFileSync(new URL('../api/delete-listing.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');
const response=()=>({code:200,setHeader(){},status(c){this.code=c;return this;},json(v){this.value=v;return this;}});
const method=(req,res,verb)=>{if(req.method===verb)return true;res.status(405).json({});return false;};
for(const scenario of ['success','cleanup-failure','booked','other-owner','driver','anonymous']){
 test(`listing API ${scenario} preserves ownership and FK protections`,async()=>{
  let cleanups=0,deletes=0;const scope=[];
  const admin={from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:scenario==='driver'?'driver':'host'}})})}),delete:()=>{deletes++;return {eq(field,value){scope.push([field,value]);return this;},select:async()=>({data:scenario==='other-owner'?[]:[{id:52}],error:scenario==='booked'?{code:'23503'}:null})};}})};
  const handler=new Function('jsonMethod','requireUser','supabaseAdmin','cleanupListingPhotos','listingDeletionFailureMessage',deleteSource)(method,async(req,res)=>{if(scenario==='anonymous'){res.status(401).json({});return null;}return {id:host};},admin,async()=>{cleanups++;if(scenario==='cleanup-failure')throw Error('outage');return {pending:false};},listingDeletionFailureMessage);
  const res=response();await handler({method:'POST',body:{listingId:52,hostId:'forged-other-host'}},res);
  const code={success:200,'cleanup-failure':200,booked:409,'other-owner':404,driver:403,anonymous:401}[scenario];assert.equal(res.code,code);
  assert.equal(cleanups,code===200?1:0);assert.equal(deletes,['driver','anonymous'].includes(scenario)?0:1);
  if(deletes)assert.deepEqual(scope,[['id',52],['host_id',host]]);
  if(code===200)assert.equal(res.value.photoCleanupPending,scenario==='cleanup-failure');
 });
}
test('cron rejects missing configuration and bad credentials before touching Storage',async()=>{
 const source=readFileSync(new URL('../api/cleanup-listing-photos.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');
 for(const [secret,authorization,expected] of [[null,'Bearer undefined',401],['secret','Bearer wrong',401],['secret','Bearer secret',200]]){
  let calls=0;const handler=new Function('timingSafeEqual','supabaseAdmin','cleanupListingPhotos','process','Buffer',source)(timingSafeEqual,{},async()=>{calls++;return {processed:0,pending:false};},{env:{CRON_SECRET:secret}},Buffer);
  const res=response();await handler({method:'GET',headers:{authorization}},res);assert.equal(res.code,expected);assert.equal(calls,expected===200?1:0);
 }
});
