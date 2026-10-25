import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
const source=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
const start=source.indexOf('function MyBookingsView(');
const effectStart=source.indexOf('  useEffect(() => {\n    if (!user) return;',start);
const effectCode=source.slice(effectStart,source.indexOf('  // Scroll to and briefly highlight',effectStart));
const windowStart=source.indexOf('function clientBookingWindow(');
const windowCode=source.slice(windowStart,source.indexOf('async function requestBookingCancellation(',windowStart));
const helpers=new Function(windowCode+';return {clientBookingWindow,clientBookingDisplay};')();
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=async()=>{await new Promise(resolve=>setImmediate(resolve));};
const row=(owner,id=owner==='A'?1:2)=>({id,listing_id:id,renter_id:owner,status:'confirmed',hours:2,total:27.6,booking_date:'2050-10-20',start_hour:9,
 scheduled_starts_at:'2050-10-20T13:00:00Z',property_time_zone:'America/Toronto',paid_at:'2050-10-01T00:00:00Z',spot_label:'A',license_plate:owner+'-PRIVATE',
 listings:{title:owner+' driveway',address:owner+' PRIVATE ADDRESS',profiles:{name:owner+' Host'}}});
function harness(){
 const state={rows:[],loading:false,error:''},writes=[],requests=[],covers=[],deps=[];
 const setter=key=>value=>{state[key]=typeof value==='function'?value(state[key]):value;writes.push({key,value:state[key]});};
 function launch(owner,{session,response,cover}={}){
  const reply=response||later();let run;
  const injected={user:{id:owner},bookingReload:0,supabase:{auth:{getSession:()=>session?.promise||Promise.resolve({data:{session:{access_token:owner+'-token',user:{id:owner}}}})}},
   useEffect:(callback,dependencies)=>{run=callback;deps.push(dependencies);},fetch:async(url,options)=>{requests.push({owner,url,...options});return reply.promise;},
   setLoading:setter('loading'),setLoadError:setter('error'),setDbBookings:setter('rows'),
   fetchPrivateCoverDataUrl:(...args)=>{covers.push({owner,args});return cover?.promise||Promise.resolve(null);},
   bookingEventFromRow:()=>null,...helpers};
  new Function(...Object.keys(injected),effectCode)(...Object.values(injected));
  const stop=run();return {stop:typeof stop==='function'?stop:()=>{},reply};
 }
 return {state,writes,requests,covers,deps,launch};
}
const success=rows=>({ok:true,json:async()=>({bookings:rows})});
test('stale booking response cannot overwrite the new account',async()=>{
 const h=harness(),a=h.launch('A');await tick();a.stop();const b=h.launch('B');await tick();b.reply.resolve(success([row('B')]));await tick();a.reply.resolve(success([row('A')]));await tick();
 assert.equal(h.state.rows.length,1);assert.equal(h.state.rows[0].listing.address,'B PRIVATE ADDRESS');assert.equal(h.state.rows[0].vehicle.licensePlate,'B-PRIVATE');
 assert.equal(h.covers.some(c=>c.owner==='A'),false,'stale booking must not start private photo requests');assert.equal(h.requests[0].signal.aborted,true);
});
test('account switch clears old cards, errors and loading state before the next response',async()=>{
 const h=harness(),a=h.launch('A');await tick();a.reply.resolve(success([row('A')]));await tick();assert.equal(h.state.rows.length,1);a.stop();h.state.error='A error';h.launch('B');
 assert.deepEqual(h.state.rows,[]);assert.equal(h.state.error,'');assert.equal(h.state.loading,true);
});
test('late errors from a previous account cannot replace a successful new load',async()=>{
 const h=harness(),a=h.launch('A');await tick();a.stop();const b=h.launch('B');await tick();b.reply.resolve(success([row('B')]));await tick();const count=h.writes.length;a.reply.reject(Error('A network failure'));await tick();assert.equal(h.writes.length,count);assert.equal(h.state.error,'');assert.equal(h.state.rows[0].rawId,2);
});
test('late authorized cover data is ignored after cleanup, even if the transport ignores abort',async()=>{
 const h=harness(),photo=later(),a=h.launch('A',{cover:photo});await tick();a.reply.resolve(success([row('A')]));await tick();assert.equal(h.covers.length,1);a.stop();h.launch('B');await tick();const count=h.writes.length;photo.resolve('data:image/webp;base64,A-PRIVATE');await tick();assert.equal(h.writes.length,count);assert.deepEqual(h.state.rows,[]);assert.equal(h.covers[0].args[3].aborted,true);
});
test('the session owner must match the requested account before any booking request',async()=>{
 const h=harness(),session=later();h.launch('A',{session});session.resolve({data:{session:{access_token:'B-token',user:{id:'B'}}}});await tick();assert.equal(h.requests.length,0);assert.deepEqual(h.state.rows,[]);assert.equal(h.state.loading,false);assert.match(h.state.error,/couldn't load/i);
});
test('unmount during session lookup starts no request and writes no state afterward',async()=>{
 const h=harness(),session=later(),a=h.launch('A',{session});a.stop();const count=h.writes.length;session.resolve({data:{session:{access_token:'A-token',user:{id:'A'}}}});await tick();assert.equal(h.requests.length,0);assert.equal(h.writes.length,count);
});
test('unmount while reading JSON ignores its late booking payload',async()=>{
 const h=harness(),json=later(),a=h.launch('A');await tick();a.reply.resolve({ok:true,json:()=>json.promise});await tick();a.stop();const count=h.writes.length;json.resolve({bookings:[row('A')]});await tick();assert.equal(h.writes.length,count);assert.equal(h.covers.length,0);
});
test('session lookup failure and malformed payload end loading without retaining cards',async()=>{
 for(const kind of ['session','payload','http']){
  const h=harness(),session=kind==='session'?later():null,a=h.launch('A',{session});
  if(session)session.reject(Error('Session unavailable'));else{await tick();a.reply.resolve(kind==='http'?{ok:false}:success(null));}
  await tick();assert.equal(h.state.loading,false);assert.match(h.state.error,/couldn't load/i);assert.deepEqual(h.state.rows,[]);
 }
});
test('successful current-account load preserves details and hydrates only its own private cover',async()=>{
 const h=harness(),photo=later(),a=h.launch('A',{cover:photo});await tick();a.reply.resolve(success([row('A')]));await tick();photo.resolve('data:image/webp;base64,AUTHORIZED');await tick();assert.equal(h.state.rows[0].listing.img,'data:image/webp;base64,AUTHORIZED');assert.equal(h.state.rows[0].spotLabel,'A');assert.equal(h.state.rows[0].total,27.6);assert.equal(h.requests[0].headers.Authorization,'Bearer A-token');assert.ok(h.requests[0].signal instanceof AbortSignal);assert.deepEqual(h.covers[0].args.slice(0,3),[1,1,'A-token']);assert.deepEqual(h.deps,[['A',0]]);assert.equal(h.requests[0].cache,'no-store');assert.equal(h.state.loading,false);
});
test('Driver card uses the server total including extensions without recalculating a charge',async()=>{
 const h=harness(),a=h.launch('A');await tick();a.reply.resolve(success([{...row('A'),charged_total:51.75}]));await tick();
 assert.equal(h.state.rows[0].total,51.75);
});
test('React key isolates account-owned cards, filters and action dialogs on identity change',async()=>{
 const tag=source.match(/<MyBookingsView\b[^>]*\/>/)[0];const compiled=await transform(`function Parent({user}){return ${tag};}`,{loader:'jsx'});
 const names=['React','MyBookingsView','setMessageThread','setExtendBookingId','navigateToParking','changeNavigationApp','viewBookingId'];
 const Parent=new Function(...names,compiled.code+';return Parent;')(React,()=>null,()=>{},()=>{},()=>{},()=>{},null);
 assert.equal(Parent({user:{id:'A'}}).key,'A');assert.equal(Parent({user:{id:'B'}}).key,'B');assert.doesNotThrow(()=>Parent({user:null}));
});
