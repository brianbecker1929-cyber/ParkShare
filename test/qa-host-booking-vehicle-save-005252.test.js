import test from 'node:test';
import assert from 'node:assert/strict';
import {saveBookingVehicle} from '../src/lib/saveBookingVehicle.js';
import {bookingVehicleMetadata} from '../src/lib/bookingVehicle.js';
const vehicle={vehicleMake:'Honda',vehicleModel:'Civic',vehicleColour:'Blue',licensePlate:'HOST 123'};
const session=(id='self')=>({data:{session:{user:{id,user_metadata:bookingVehicleMetadata(vehicle)},access_token:`${id}-token`}}});
const later=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({auth=async()=>session(),refresh=async()=>session(),patch=async()=>({ok:true,json:async()=>({vehicle:{...vehicle,role:'driver',id:'other'}})})}={}){
  const requests=[],refreshes=[];let current=true,n=0;
  const client={auth:{getSession:()=>auth(++n),refreshSession:()=>{refreshes.push(true);return refresh();}}};
  const run=()=>saveBookingVehicle({client,vehicle:{...vehicle,role:'driver'},accountId:'self',isCurrent:()=>current,fetcher:async(url,options)=>{requests.push({url,options});return patch();}});
  return {run,requests,refreshes,stop:()=>{current=false;}};
}
test('save uses explicit account-owned token, freezes allowlisted fields and confirms refreshed vehicle metadata',async()=>{
  const f=fixture();assert.deepEqual(await f.run(),vehicle);assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'/api/booking-vehicle');assert.equal(f.requests[0].options.headers.Authorization,'Bearer self-token');assert.deepEqual(JSON.parse(f.requests[0].options.body),vehicle);assert.equal(f.refreshes.length,1);
});
test('wrong account before save cannot PATCH; an account switch after PATCH cannot refresh the other account',async()=>{
  for(const when of ['before','after']){const f=fixture({auth:async n=>session(when==='before'||n>1?'other':'self')});await assert.rejects(f.run(),when==='before'?/account changed/:/vehicle was saved/);assert.equal(f.requests.length,when==='before'?0:1);assert.equal(f.refreshes.length,0);}
});
test('disposal during auth prevents writes; disposal after PATCH prevents refresh and publication',async()=>{
  for(const phase of ['auth','patch']){const p=later(),f=fixture(phase==='auth'?{auth:()=>p.promise}:{patch:()=>p.promise});const work=f.run();await tick();f.stop();p.resolve(phase==='auth'?session():{ok:true,json:async()=>({vehicle})});assert.equal(await work,null);assert.equal(f.requests.length,phase==='auth'?0:1);assert.equal(f.refreshes.length,0);}
});
test('unmount during response parsing or refresh ignores late results',async()=>{
  for(const phase of ['json','refresh']){const p=later(),f=fixture(phase==='json'?{patch:async()=>({ok:true,json:()=>p.promise})}:{refresh:()=>p.promise});const work=f.run();await tick();f.stop();p.resolve(phase==='json'?{vehicle}:session());assert.equal(await work,null);}
});
test('malformed canonical vehicle and HTTP field errors never become a selected saved vehicle',async()=>{
  for(const payload of [{},{vehicle:{}},{vehicle:{...vehicle,licensePlate:''}}]){const f=fixture({patch:async()=>({ok:true,json:async()=>payload})});await assert.rejects(f.run(),/confirm your saved vehicle/);assert.equal(f.refreshes.length,0);}
  const f=fixture({patch:async()=>({ok:false,json:async()=>({error:'Check plate',errors:{licensePlate:'Invalid plate'}})})});await assert.rejects(f.run(),e=>e.fieldErrors.licensePlate==='Invalid plate');
});
test('a stale, failed or switched refreshed session cannot publish a confirmed save',async()=>{
  for(const refresh of [async()=>({error:{}}),async()=>session('other'),async()=>({data:{session:{user:{id:'self',user_metadata:{}},access_token:'token'}}})]){const f=fixture({refresh});await assert.rejects(f.run(),/vehicle was saved/);}
  const f=fixture({auth:async n=>session(n===3?'other':'self')});await assert.rejects(f.run(),/vehicle was saved/);
});
