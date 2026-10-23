import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {transform} from 'esbuild';
import {validId} from '../src/lib/privateListingAccess.js';
import {cancellationDeadlineError} from '../src/lib/bookingTime.js';
const source=await readFile(process.env.QA_CANCELLATION_CONTEXT_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const start=source.indexOf('async function requestBookingCancellation('),end=source.indexOf('function CancellationModal(',start);
let code=source.slice(start,end);
if(!code.includes('function useBookingCancellation(')){
 // Execute the previous Driver's actual handler to reproduce its races.
 const a=source.indexOf('  const cancelDriverBooking = async () => {'),b=source.indexOf('\n  };',a)+6;
 code+='\nfunction useBookingCancellation(user,reason,onCancelled){const [cancelTarget,setCancelTarget]=useState(null);const [cancelBusy,setCancelBusy]=useState(false);const [cancelError,setCancelError]=useState("");const [cancelNotice,setCancelNotice]=useState("");'+source.slice(a,b)+';return {target:cancelTarget,busy:cancelBusy,error:cancelError,notice:cancelNotice,open:booking=>{setCancelError("");setCancelTarget(booking);},close:()=>{if(!cancelBusy)setCancelTarget(null);},confirm:cancelDriverBooking};}';
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const session=id=>({data:{session:{access_token:id+'-token',user:{id}}}});
const booking=(id=42)=>({rawId:id,driver:'PRIVATE DRIVER '+id,listing:{title:'PRIVATE LISTING '+id,address:'PRIVATE ADDRESS',photos:['PRIVATE PHOTO']},vehicle:{plate:'PRIVATE PLATE'}});
const success=()=>Response.json({bookingStatus:'refunded',message:'Current booking cancelled'});
function harness({auth=async()=>session('A'),refresh=async()=>session('A'),fetcher=async()=>success(),actor='Driver',now=Date.now()}={}){
 const slots=[],effects=[],requests=[],updates=[],writes=[];let cursor=0,changed=false,result,owner='A',refreshes=0,clock=now;const cleanups=[];
 const values={useState:initial=>{const n=cursor++;if(!slots[n])slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{const next=typeof v==='function'?v(slots[n].value):v;writes.push(n);if(next!==slots[n].value){slots[n].value=next;changed=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useEffect:(fn,deps)=>{const n=cursor++;if(!slots[n]){slots[n]={deps};effects.push(fn);}},
  supabase:{auth:{getSession:()=>auth(),refreshSession:()=>{refreshes++;return refresh();}}},validId,cancellationDeadlineError:(deadline,at=clock)=>cancellationDeadlineError(deadline,at),fetch:(url,init)=>{requests.push({url,...init});return fetcher(url,init);},setDbBookings:fn=>{updates.push(fn([{rawId:42},{rawId:43}]));}};
 const hook=new Function(...Object.keys(values),code+';return useBookingCancellation;')(...Object.values(values));
 function render(id=owner){owner=id;let count=0;do{changed=false;cursor=0;result=hook(id?{id}:null,'Cancelled by '+actor,(id,data)=>updates.push({id,data}));assert.ok(++count<5);}while(changed);for(const fn of effects.splice(0))cleanups.push(fn());return result;}
 function stop(){for(const cleanup of cleanups.splice(0))cleanup?.();}
 const open=(id=42,extra={})=>{render().open({...booking(id),...extra});return render();};
 return {render,open,stop,requests,updates,writes,setTime:value=>{clock=value;},get refreshes(){return refreshes;}};
}

test('cancellation rejects a different current account before POST, without refreshing it',async()=>{
 const h=harness({auth:async()=>session('B')});await h.open().confirm();assert.equal(h.requests.length,0);assert.equal(h.refreshes,0);assert.match(h.render().error,/account changed|session changed/i);h.stop();
});
test('cancellation rejects a different refreshed account before POST',async()=>{
 const h=harness({auth:async()=>({data:{session:null}}),refresh:async()=>session('B')});await h.open().confirm();assert.equal(h.refreshes,1);assert.equal(h.requests.length,0);assert.match(h.render().error,/session changed/i);h.stop();
});
test('unmount during session lookup prevents a new cancellation POST and all late UI writes',async()=>{
 const lookup=deferred(),h=harness({auth:()=>lookup.promise}),work=h.open().confirm();h.stop();const n=h.writes.length;lookup.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.updates.length,0);assert.equal(h.writes.length,n);
});
test('rapid cancellation confirmation clicks start exactly one request before React renders',async()=>{
 const reply=deferred(),h=harness({fetcher:()=>reply.promise}),dialog=h.open();const one=dialog.confirm(),two=dialog.confirm();await tick();assert.equal(h.requests.length,1);reply.resolve(success());await Promise.all([one,two]);assert.equal(h.updates.length,1);assert.equal(h.render().target,null);h.stop();
});
test('late cancellation error after account change cannot appear in the next dialog',async()=>{
 const reply=deferred(),h=harness({fetcher:()=>reply.promise}),work=h.open().confirm();await tick();h.render('B');const n=h.writes.length;reply.reject(Error('A PRIVATE CANCELLATION ERROR'));await work;assert.equal(h.writes.length,n);assert.equal(h.render('B').error,'');assert.equal(h.render().notice,'');assert.equal(h.render().target,null);h.stop();
});
test('account changes clear the rendered target immediately and A-B-A cannot revive old intent',async()=>{
 const h=harness(),old=h.open();assert.match(old.target.listing.title,/42/);assert.equal(h.render('B').target,null);h.render('A');await old.confirm();old.close();old.open(booking(42));assert.equal(h.render('A').target,null);assert.equal(h.requests.length,0);h.stop();
});
test('dismissal immediately invalidates a queued old confirmation before render',async()=>{
 const h=harness(),dialog=h.open();dialog.close();await dialog.confirm();assert.equal(h.requests.length,0);assert.equal(h.render().target,null);h.stop();
});
test('old close and confirm callbacks cannot affect a replacement booking, including the same ID',async()=>{
 for(const id of [42,43]){const h=harness(),old=h.open(),key=old.requestKey;old.open(booking(id));const current=h.render();assert.notEqual(current.requestKey,key);old.close();await old.confirm();assert.equal(h.render().target.rawId,id);assert.equal(h.requests.length,0);await current.confirm();assert.equal(JSON.parse(h.requests[0].body).bookingId,id);h.stop();}
});
test('unmount during refresh prevents POST; refresh errors are visible only in the current dialog',async()=>{
 for(const disposed of [false,true]){const refresh=deferred(),h=harness({auth:async()=>({data:{session:null}}),refresh:()=>refresh.promise}),work=h.open().confirm();await tick();if(disposed)h.stop();const n=h.writes.length;refresh.reject(Error('Refresh unavailable'));await work;assert.equal(h.requests.length,0);if(disposed)assert.equal(h.writes.length,n);else{assert.equal(h.render().error,'Refresh unavailable');assert.equal(h.render().busy,false);h.stop();}}
});
test('account invalidation while lookup or refresh is pending prevents a new POST',async()=>{
 for(const phase of ['lookup','refresh']){const pending=deferred(),h=harness({auth:phase==='lookup'?()=>pending.promise:async()=>({data:{session:null}}),refresh:()=>pending.promise}),work=h.open().confirm();await tick();h.render('B');const n=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.writes.length,n);h.stop();}
});
test('an already-submitted cancellation cannot apply success to a disposed or replacement account',async()=>{
 for(const phase of ['response','body']){const pending=deferred(),h=harness({fetcher:phase==='response'?()=>pending.promise:async()=>({ok:true,json:()=>pending.promise})}),work=h.open().confirm();await tick();h.stop();const n=h.writes.length;pending.resolve(phase==='response'?success():{bookingStatus:'refunded',message:'OLD PRIVATE RESULT'});await work;assert.equal(h.requests.length,1);assert.equal(h.updates.length,0);assert.equal(h.writes.length,n);}
});
test('pending confirmation locks dismissal and target replacement until its result is known',async()=>{
 const lookup=deferred(),h=harness({auth:()=>lookup.promise}),dialog=h.open(),work=dialog.confirm();dialog.close();h.render().open(booking(43));assert.equal(h.render().target.rawId,42);assert.equal(h.render().busy,true);lookup.resolve(session('A'));await work;assert.equal(h.requests.length,1);assert.equal(JSON.parse(h.requests[0].body).bookingId,42);assert.equal(h.render().target,null);h.stop();
});
test('current Driver and Host cancellation keep the original ID, reason, status and notice',async()=>{
 for(const actor of ['Driver','Host']){const h=harness({actor});await h.open().confirm();assert.equal(h.requests[0].url,'/api/cancel-booking');assert.equal(h.requests[0].method,'POST');assert.equal(h.requests[0].headers.Authorization,'Bearer A-token');assert.deepEqual(JSON.parse(h.requests[0].body),{bookingId:42,reason:'Cancelled by '+actor});assert.equal(h.updates[0].id,42);assert.equal(h.updates[0].data.bookingStatus,'refunded');assert.equal(h.render().notice,'Current booking cancelled');h.stop();}
});
test('same-account session refresh works; failure unlocks explicit retry without automatic replay',async()=>{
 let calls=0;const h=harness({auth:async()=>({data:{session:null}}),refresh:async()=>session('A'),fetcher:async()=>++calls===1?Response.json({error:'Server unavailable'},{status:503}):success()});await h.open().confirm();assert.equal(calls,1);assert.equal(h.render().busy,false);assert.equal(h.render().error,'Server unavailable');await h.render().confirm();assert.equal(calls,2);assert.equal(h.refreshes,2);assert.equal(h.render().target,null);h.stop();
});
test('invalid booking IDs and signed-out cancellation intents never access auth or fetch',async()=>{
 let calls=0;const h=harness({auth:async()=>{calls++;return session('A');}});for(const id of [null,0,-1,'db-42','bad',{},NaN]){h.render().open(booking(id));await h.render().confirm();}h.render(null).open(booking(42));await h.render(null).confirm();assert.equal(calls,0);assert.equal(h.requests.length,0);h.stop();
});
test('confirmation copies only display fields and ID; source mutation cannot change its booking',async()=>{
 const h=harness(),input=booking(42);h.render().open(input);input.rawId=43;input.listing.title='CHANGED';const dialog=h.render();assert.equal(dialog.target.rawId,42);assert.match(dialog.target.listing.title,/42/);assert.doesNotMatch(JSON.stringify(dialog.target),/PRIVATE ADDRESS|PRIVATE PLATE|PRIVATE PHOTO/);await dialog.confirm();assert.equal(JSON.parse(h.requests[0].body).bookingId,42);h.stop();
});
test('same-account profile rerender preserves the current dialog and pending token',async()=>{
 const reply=deferred(),h=harness({fetcher:()=>reply.promise}),dialog=h.open(),work=dialog.confirm();await tick();const next=h.render('A');assert.equal(next.requestKey,dialog.requestKey);assert.equal(next.busy,true);await next.confirm();assert.equal(h.requests.length,1);reply.resolve(Response.json({bookingStatus:'pending',message:'Refund processing'}));await work;assert.equal(h.render().notice,'Refund processing');assert.equal(h.updates.length,1);h.stop();
});

test('expired Driver intent cannot look up auth or POST a cancellation',async()=>{
 let authCalls=0;const h=harness({now:1001,auth:async()=>{authCalls++;return session('A');}});await h.open(42,{cancellationDeadline:1000}).confirm();assert.equal(authCalls,0);assert.equal(h.requests.length,0);assert.match(h.render().error,/Self-service cancellation is no longer available/);assert.equal(h.render().busy,false);h.stop();
});
test('exact cutoff remains eligible and the copied deadline cannot be extended by mutating its source',async()=>{
 const h=harness({now:1000}),input={...booking(),cancellationDeadline:1000};h.render().open(input);input.cancellationDeadline=9000;assert.equal(h.render().target.cancellationDeadline,1000);await h.render().confirm();assert.equal(h.requests.length,1);h.stop();
});
test('expiry during session lookup or refresh blocks the cancellation POST',async()=>{
 for(const phase of ['lookup','refresh']){const pending=deferred(),h=harness({now:999,auth:phase==='lookup'?()=>pending.promise:async()=>({data:{session:null}}),refresh:()=>pending.promise});const work=h.open(42,{cancellationDeadline:1000}).confirm();await tick();h.setTime(1001);pending.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.match(h.render().error,/Contact support/);assert.equal(h.render().busy,false);h.stop();}
});
test('a cancellation sent before cutoff still applies its verified response after cutoff',async()=>{
 const reply=deferred(),h=harness({now:999,fetcher:()=>reply.promise});const work=h.open(42,{cancellationDeadline:1000}).confirm();await tick();assert.equal(h.requests.length,1);h.setTime(1001);reply.resolve(success());await work;assert.equal(h.updates.length,1);assert.equal(h.render().target,null);assert.match(h.render().notice,/cancelled/);h.stop();
});
test('missing optional deadline preserves Host handling and invalid supplied deadlines fail closed',async()=>{
 const host=harness({actor:'Host',now:1001});await host.open().confirm();assert.equal(host.requests.length,1);host.stop();
 for(const cancellationDeadline of [null,NaN,Infinity,'1000']){const h=harness({now:999});await h.open(42,{cancellationDeadline}).confirm();assert.equal(h.requests.length,0);assert.match(h.render().error,/Contact support/);h.stop();}
});

for(const [name,next,actor,handler] of [['HostDashboard','// ─── Messages Inbox','Host','cancelHostBooking'],['MyBookingsView','function ReviewModal(','Driver','cancelDriverBooking']]){
 test(`actual ${actor} view wires its booking update, scoped open, close, confirm and modal key`,async()=>{
  const a=source.indexOf('function '+name+'('),view=source.slice(a,source.indexOf(next,a));let passed;
  const from=view.indexOf('  const { target: cancelTarget'),to=view.indexOf('\n    });',from)+8;
  const updates=[];const props={target:{rawId:42,driver:'Driver',listing:{title:'Listing'},cancellationDeadline:1000},busy:false,error:'',notice:'',requestKey:7,open:()=>{},close:()=>{},confirm:()=>{}};
  const bindings=new Function('useBookingCancellation','user','setDbBookings',view.slice(from,to)+';return {cancelTarget,cancelBusy,cancelError,cancelNotice,cancellationKey,openCancellation,closeCancellation,'+handler+'};')((...args)=>{passed=args;return props;},{id:'A'},fn=>updates.push(fn([{rawId:42},{rawId:43}])));
  assert.equal(passed[0].id,'A');assert.equal(passed[1],'Cancelled by '+actor);passed[2](42,{bookingStatus:'refunded'});assert.equal(updates[0][0].status,'Cancelled');assert.equal(updates[0][0].canCancel,false);assert.equal(updates[0][1].status,undefined);passed[2](42,{bookingStatus:'pending'});assert.equal(updates[1][0].status,'Cancellation pending');
  const tagStart=view.indexOf('<CancellationModal\n'),tag=view.slice(tagStart,view.indexOf('/>',tagStart)+2),compiled=await transform('function Parent(){return '+tag+';}',{loader:'jsx'});const values={React,CancellationModal:()=>null,...bindings};const modal=new Function(...Object.keys(values),compiled.code+';return Parent;')(...Object.values(values))();assert.equal(modal.key,'7');assert.equal(modal.props.onClose,props.close);assert.equal(modal.props.onConfirm,props.confirm);if(actor==='Driver')assert.equal(modal.props.cancellationDeadline,1000);assert.match(view,/openCancellation\(b\)/);
 });
}
