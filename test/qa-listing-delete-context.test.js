import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {transform} from 'esbuild';
import {validId} from '../src/lib/privateListingAccess.js';
const app=await readFile(process.env.QA_LISTING_DELETE_APP||new URL('../src/App.jsx',import.meta.url),'utf8');
const helper=await readFile(process.env.QA_LISTING_DELETE_HELPER||new URL('../src/lib/listingDeletion.js',import.meta.url),'utf8');
const a=app.indexOf('function useHostListingDeletion(');let hook;
if(a>=0)hook=app.slice(a,app.indexOf('function HostDashboard(',a));
else{
 const from=app.indexOf('  const deleteListing = async (rawId, displayId) => {'),to=app.indexOf('\n  const saveListingEdit',from);
 // Execute the actual old dashboard handler; the wrapper supplies its real
 // selected-row props and state, not an alternative deletion implementation.
 hook='function useHostListingDeletion(user,onDeleted){const [deletingId,setDeletingId]=useState(null);const [confirmDeleteId,setConfirmDeleteId]=useState(null);const [selected,setSelected]=useState(null);'+app.slice(from,to)+';return {deletingId,confirmDeleteId,open:l=>{setSelected(l);setConfirmDeleteId(l.id);},close:()=>setConfirmDeleteId(null),confirm:()=>selected?deleteListing(selected.rawId,selected.id):undefined};}';
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const session=id=>({data:{session:{user:{id},access_token:id+'-token'}}});
const listing=(id=7)=>({rawId:id,id:'db-'+id,title:'PRIVATE TITLE',address:'PRIVATE ADDRESS',photos:['PRIVATE PHOTO']});
const success=(pending=false)=>Response.json({deleted:true,photoCleanupPending:pending});
function harness({auth=async()=>session('A'),fetcher=async()=>success()}={}){
 const slots=[],effects=[],cleanups=[],writes=[],requests=[],alerts=[],removed=[];let cursor=0,changed=false,result,owner='A',authCalls=0;
 const values={validId,useState:initial=>{const n=cursor++;if(!slots[n])slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;changed=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useEffect:fn=>{const n=cursor++;if(!slots[n]){slots[n]={};effects.push(fn);}},supabase:{auth:{getSession:()=>{authCalls++;return auth();}}},fetch:(url,init)=>{requests.push({url,...init});return fetcher(url,init);},alert:message=>alerts.push(message),setDbListings:fn=>{removed.push(fn([{id:'db-7'},{id:'db-8'}]));}};
 const factory=new Function(...Object.keys(values),helper.replaceAll('export ','')+'\n'+hook+';return {useHostListingDeletion,deleteHostListing};')(...Object.values(values));
 function render(id=owner){owner=id;let count=0;do{cursor=0;changed=false;result=factory.useHostListingDeletion(id?{id}:null,id=>removed.push(id));assert.ok(++count<5);}while(changed);for(const effect of effects.splice(0))cleanups.push(effect());return result;}
 const open=(id=7)=>{render().open(listing(id));return render();};
 const stop=()=>{for(const cleanup of cleanups.splice(0))cleanup?.();};
 return {render,open,stop,requests,alerts,removed,writes,slots,get authCalls(){return authCalls;},direct:(input)=>factory.deleteHostListing(values.supabase,input)};
}

test('Host deletion rejects a different session account before any POST',async()=>{
 const h=harness({auth:async()=>session('B')});await h.open().confirm();assert.equal(h.requests.length,0);assert.equal(h.removed.length,0);assert.match(h.alerts[0],/account changed/i);h.stop();
});
test('leaving the dashboard during session lookup prevents a new deletion POST and all late UI writes',async()=>{
 const lookup=deferred(),h=harness({auth:()=>lookup.promise}),work=h.open().confirm();h.stop();const n=h.writes.length;lookup.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.writes.length,n);assert.equal(h.alerts.length,0);assert.equal(h.removed.length,0);
});
test('rapid Delete clicks start one request before React renders',async()=>{
 const reply=deferred(),h=harness({fetcher:()=>reply.promise}),dialog=h.open(),one=dialog.confirm(),two=dialog.confirm();await tick();assert.equal(h.requests.length,1);reply.resolve(success());await Promise.all([one,two]);assert.equal(h.removed.length,1);assert.equal(h.render().confirmDeleteId,null);h.stop();
});
test('late deletion failures cannot alert or close a new account confirmation',async()=>{
 const reply=deferred(),h=harness({fetcher:()=>reply.promise}),work=h.open().confirm();await tick();h.render('B').open(listing(8));h.render('B');const n=h.writes.length;reply.resolve(Response.json({error:'A PRIVATE FAILURE'},{status:503}));await work;assert.equal(h.alerts.length,0);assert.equal(h.writes.length,n);assert.equal(h.render('B').confirmDeleteId,'db-8');h.stop();
});
test('Keep immediately invalidates a queued old Delete callback before the next render',async()=>{
 const h=harness(),dialog=h.open();dialog.close();await dialog.confirm();assert.equal(h.requests.length,0);assert.equal(h.render().confirmDeleteId,null);h.stop();
});
test('replacing a confirmation rejects its old close and Delete callbacks, including same-ID replacements',async()=>{
 for(const id of [7,8]){const h=harness(),old=h.open();old.open(listing(id));const current=h.render();old.close();await old.confirm();assert.equal(h.requests.length,0);assert.equal(h.render().confirmDeleteId,'db-'+id);await current.confirm();assert.equal(JSON.parse(h.requests[0].body).listingId,id);h.stop();}
});
test('account changes clear confirmation immediately; A-B-A cannot revive an old deletion',async()=>{
 const h=harness(),old=h.open();assert.equal(h.render('B').confirmDeleteId,null);h.render('A');old.open(listing(7));await old.confirm();old.close();assert.equal(h.requests.length,0);assert.equal(h.render().confirmDeleteId,null);h.stop();
});
test('account change while session lookup is pending blocks POST even if the old session resolves',async()=>{
 const lookup=deferred(),h=harness({auth:()=>lookup.promise}),work=h.open().confirm();h.render('B');const n=h.writes.length;lookup.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.writes.length,n);assert.equal(h.alerts.length,0);h.stop();
});
test('already-submitted deletion success cannot remove cards or show cleanup alerts after unmount',async()=>{
 for(const phase of ['response','body']){const pending=deferred(),h=harness({fetcher:phase==='response'?()=>pending.promise:async()=>({ok:true,json:()=>pending.promise})}),work=h.open().confirm();await tick();h.stop();const n=h.writes.length;pending.resolve(phase==='response'?success(true):{deleted:true,photoCleanupPending:true});await work;assert.equal(h.requests.length,1);assert.equal(h.removed.length,0);assert.equal(h.alerts.length,0);assert.equal(h.writes.length,n);}
});
test('pending deletion locks Keep and target replacement until its result is known',async()=>{
 const lookup=deferred(),h=harness({auth:()=>lookup.promise}),dialog=h.open(),work=dialog.confirm();dialog.close();h.render().open(listing(8));assert.equal(h.render().confirmDeleteId,'db-7');assert.equal(h.render().deletingId,'db-7');lookup.resolve(session('A'));await work;assert.equal(JSON.parse(h.requests[0].body).listingId,7);h.stop();
});
test('current Host success uses the authenticated endpoint and removes only the captured display ID',async()=>{
 const h=harness();await h.open().confirm();assert.equal(h.requests[0].url,'/api/delete-listing');assert.equal(h.requests[0].method,'POST');assert.equal(h.requests[0].headers.Authorization,'Bearer A-token');assert.deepEqual(JSON.parse(h.requests[0].body),{listingId:7});assert.deepEqual(h.removed,['db-7']);assert.equal(h.render().deletingId,null);assert.equal(h.render().confirmDeleteId,null);assert.equal(h.alerts.length,0);h.stop();
});
test('cleanup pending is reported only for the current successful deletion',async()=>{
 const h=harness({fetcher:async()=>success(true)});await h.open().confirm();assert.deepEqual(h.removed,['db-7']);assert.match(h.alerts[0],/Photo cleanup is queued/);h.stop();
});
test('blocked deletion preserves the server error, keeps its card and requires a fresh confirmation to retry',async()=>{
 let calls=0;const h=harness({fetcher:async()=>++calls===1?Response.json({error:'This driveway has bookings'},{status:409}):success()});await h.open().confirm();assert.equal(h.removed.length,0);assert.equal(h.alerts[0],'This driveway has bookings');assert.equal(h.render().deletingId,null);assert.equal(h.render().confirmDeleteId,null);assert.equal(calls,1);await h.open().confirm();assert.equal(calls,2);assert.deepEqual(h.removed,['db-7']);h.stop();
});
test('lost responses report an unknown outcome without replay or claiming nothing was deleted',async()=>{
 const h=harness({fetcher:async()=>{throw Error('lost response');}});await h.open().confirm();assert.equal(h.requests.length,1);assert.equal(h.removed.length,0);assert.match(h.alerts[0],/Refresh your listings/);assert.doesNotMatch(h.alerts[0],/Nothing was deleted/);h.stop();
});
test('invalid/signed-out requests and missing lifetime guards cannot start authentication or HTTP',async()=>{
 const h=harness();for(const id of [0,-1,'bad',{},NaN]){h.render().open(listing(id));await h.render().confirm();}h.render(null).open(listing(7));await h.render(null).confirm();const result=await h.direct({listingId:7,hostId:'A'});assert.equal(result.ok,false);assert.equal(h.authCalls,0);assert.equal(h.requests.length,0);h.stop();
});
test('deletion captures IDs only; source mutation cannot redirect the selected deletion',async()=>{
 const h=harness(),input=listing(7);h.render().open(input);input.rawId=8;input.id='db-8';const current=h.render();assert.equal(current.confirmDeleteId,'db-7');assert.doesNotMatch(JSON.stringify(h.slots),/PRIVATE TITLE|PRIVATE ADDRESS|PRIVATE PHOTO/);await current.confirm();assert.equal(JSON.parse(h.requests[0].body).listingId,7);assert.deepEqual(h.removed,['db-7']);h.stop();
});
test('same-account profile rerender retains the pending confirmation without duplicating its request',async()=>{
 const reply=deferred(),h=harness({fetcher:()=>reply.promise}),work=h.open().confirm();await tick();const same=h.render('A');assert.equal(same.deletingId,'db-7');await same.confirm();assert.equal(h.requests.length,1);reply.resolve(success());await work;assert.deepEqual(h.removed,['db-7']);h.stop();
});
test('missing session owner or expired session does not submit deletion; disposed lookup errors stay silent',async()=>{
 for(const value of [{data:{session:null}},{data:{session:{access_token:'token'}}},{error:Error('auth unavailable'),data:{session:null}}]){const h=harness({auth:async()=>value});await h.open().confirm();assert.equal(h.requests.length,0);assert.equal(h.removed.length,0);assert.ok(h.alerts.length);h.stop();}
 const pending=deferred(),h=harness({auth:()=>pending.promise}),work=h.open().confirm();h.stop();const n=h.writes.length;pending.reject(Error('lookup failed'));await work;assert.equal(h.alerts.length,0);assert.equal(h.writes.length,n);
});
test('actual Host Dashboard wires scoped Delete/Keep actions and removes only the returned listing',async()=>{
 const from=app.indexOf('  const { deletingId, confirmDeleteId'),to=app.indexOf('\n    });',from)+8;let received;
 const props={deletingId:null,confirmDeleteId:'db-7',open:()=>{},close:()=>{},confirm:()=>{}};
 const rows=[{id:'db-7'},{id:'db-8'}];let remaining;
 const bindings=new Function('useHostListingDeletion','user','setDbListings',app.slice(from,to)+';return {deletingId,confirmDeleteId,openListingDeletion,closeListingDeletion,deleteListing};')((...args)=>{received=args;return props;},{id:'A'},fn=>{remaining=fn(rows);});received[1]('db-7');assert.deepEqual(remaining,[{id:'db-8'}]);assert.equal(received[0].id,'A');
 const x=app.indexOf('<div className="host-dashboard-delete-confirm"'),tag=app.slice(x,app.indexOf('</div>',x)+6),built=await transform('function Row(){return '+tag+';}',{loader:'jsx'});const values={React,C:{},l:listing(),...bindings};const Row=new Function(...Object.keys(values),built.code+';return Row;')(...Object.values(values)),buttons=React.Children.toArray(Row().props.children);assert.equal(buttons[0].props.onClick,props.confirm);assert.equal(buttons[1].props.onClick,props.close);assert.equal(buttons[1].props.disabled,false);
 const busyValues={...values,deletingId:'db-7'},Busy=new Function(...Object.keys(busyValues),built.code+';return Row;')(...Object.values(busyValues));assert.equal(React.Children.toArray(Busy().props.children)[1].props.disabled,true);assert.match(app,/openListingDeletion\(l\)/);
});
