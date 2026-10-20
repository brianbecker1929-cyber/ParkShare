import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteHostListing, listingDeletionFailureMessage } from '../src/lib/listingDeletion.js';
const HOST='00000000-0000-4000-8000-000000000041';
const client=token=>({auth:{getSession:async()=>({data:{session:token?{access_token:token,user:{id:HOST}}:null}})}});
test('Host deletion uses authenticated server endpoint without browser table deletes or booking COUNT',async()=>{
 const calls=[];const result=await deleteHostListing(client('synthetic'),{listingId:52,hostId:HOST,isContextCurrent:()=>true},async(url,options)=>{
  calls.push({url,options});return {ok:true,json:async()=>({deleted:true,photoCleanupPending:false})};});
 assert.deepEqual(result,{ok:true,photoCleanupPending:false});assert.equal(calls[0].url,'/api/delete-listing');
 assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic');assert.deepEqual(JSON.parse(calls[0].options.body),{listingId:52});
});
test('blocked or wrong-owner deletions preserve the server error and never report success',async()=>{
 for(const error of ['This driveway has bookings or checkout reservations','Listing not found or not owned by this Host.']){
  const result=await deleteHostListing(client('synthetic'),{listingId:7,hostId:HOST,isContextCurrent:()=>true},async()=>({ok:false,json:async()=>({error})}));
  assert.equal(result.ok,false);assert.equal(result.message,error);
 }
 assert.match(listingDeletionFailureMessage({code:'23503'}),/No reservation was removed/);
 assert.match(listingDeletionFailureMessage({code:'42501'}),/not authorized/);
});
test('cleanup failure reports deletion success with a pending warning',async()=>{
 const r=await deleteHostListing(client('synthetic'),{listingId:52,hostId:HOST,isContextCurrent:()=>true},async()=>({ok:true,json:async()=>({deleted:true,photoCleanupPending:true})}));
 assert.deepEqual(r,{ok:true,photoCleanupPending:true});
});
test('lost responses do not falsely promise nothing was deleted',async()=>{
 const r=await deleteHostListing(client('synthetic'),{listingId:52,hostId:HOST,isContextCurrent:()=>true},async()=>{throw Error('lost response');});
 assert.equal(r.ok,false);assert.match(r.message,/Refresh your listings/);assert.doesNotMatch(r.message,/Nothing was deleted/);
});
test('invalid and unauthenticated deletion requests make no HTTP request',async()=>{
 for(const input of [{listingId:0,hostId:HOST,isContextCurrent:()=>true},{listingId:1,hostId:null},{listingId:1,hostId:HOST,isContextCurrent:()=>true}]){
  let calls=0;const r=await deleteHostListing(client(null),input,async()=>{calls++;});assert.equal(r.ok,false);assert.equal(calls,0);
 }
});
