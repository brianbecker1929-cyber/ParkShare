import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {transform} from 'esbuild';
import {validId} from '../src/lib/privateListingAccess.js';
import {validateHourlyRate} from '../src/lib/listingPrice.js';
const source=await readFile(process.env.QA_LISTING_EDIT_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const a=source.indexOf('async function persistHostListingEdit(');let code;
if(a>=0)code=source.slice(a,source.indexOf('function HostDashboard(',a));
else{const from=source.indexOf('  const saveListingEdit = async (updated) => {'),to=source.indexOf('\n  const { target: cancelTarget',from);code='function useHostListingEdit(user,onSaved){const [editingListing,setEditingListing]=useState(null);'+source.slice(from,to)+';return {listing:editingListing,open:setEditingListing,close:()=>setEditingListing(null),save:saveListingEdit,isCurrent:()=>true};}';}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const session=id=>({data:{session:{user:{id},access_token:id+'-token'}}});
const fixture=(id=7)=>({rawId:id,id:'db-'+id,title:'PRIVATE TITLE',address:'PRIVATE ADDRESS',photos:['PRIVATE PHOTO'],price:12,description:'Old description',features:['CCTV'],spots:[{id:'A',bounds:{north:1,south:0,east:1,west:0},forRent:true}],spaces:1});
const saved=(id=7)=>({id,price:'13.50',description:'Server description',features:['Covered'],spots:[{id:'A',bounds:{north:1,south:0,east:1,west:0},forRent:true}],spaces:1});
function harness({auth=async()=>session('A'),reply=async()=>({data:saved(),error:null})}={}){
 const slots=[],effects=[],cleanups=[],writes=[],queries=[],updates=[],alerts=[];let cursor=0,changed=false,result,owner='A',authCalls=0;
 const values={validId,validateHourlyRate,structuredClone,useState:initial=>{const n=cursor++;if(!slots[n])slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;changed=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useEffect:fn=>{const n=cursor++;if(!slots[n]){slots[n]={};effects.push(fn);}},alert:m=>alerts.push(m),setDbListings:fn=>updates.push(fn([fixture(7),fixture(8)])),supabase:{auth:{getSession:()=>{authCalls++;return auth();}},from:table=>({update:payload=>{const query={table,payload,filters:[],select:null};queries.push(query);const builder={eq:(key,value)=>{query.filters.push([key,value]);return builder;},select:columns=>{query.select=columns;return builder;},maybeSingle:()=>reply(query),then:(yes,no)=>Promise.resolve(reply(query)).then(yes,no)};return builder;}})}};
 const Hook=new Function(...Object.keys(values),code+';return useHostListingEdit;')(...Object.values(values));
 function render(id=owner){owner=id;let n=0;do{cursor=0;changed=false;result=Hook(id?{id}:null,(id,data)=>updates.push({id,data}));assert.ok(++n<5);}while(changed);for(const fn of effects.splice(0))cleanups.push(fn());return result;}
 const open=(id=7)=>{render().open(fixture(id));return render();};
 const stop=()=>{for(const fn of cleanups.splice(0))fn?.();};
 return {render,open,stop,queries,updates,alerts,writes,slots,get authCalls(){return authCalls;}};
}

test('zero-row listing update is rejected instead of reporting success or changing the card',async()=>{
 const h=harness({reply:async()=>({data:null,error:null})}),editor=h.open();await assert.rejects(editor.save({...fixture(),price:13}),/wasn't updated/);assert.equal(h.updates.length,0);assert.ok(h.render().listing);h.stop();
});
test('listing save rejects a different session owner before issuing an update',async()=>{
 const h=harness({auth:async()=>session('B')}),editor=h.open();await assert.rejects(editor.save(fixture()),/account changed|expired/i);assert.equal(h.queries.length,0);assert.equal(h.updates.length,0);h.stop();
});
test('rapid saves issue one update before React renders',async()=>{
 const pending=deferred(),h=harness({reply:()=>pending.promise}),editor=h.open(),one=editor.save(fixture()),two=editor.save(fixture());await tick();assert.equal(h.queries.length,1);pending.resolve({data:saved(),error:null});assert.deepEqual(await Promise.all([one,two]),[true,false]);assert.equal(h.updates.length,1);h.stop();
});
test('closing editor immediately invalidates a queued old Save before another render',async()=>{
 const h=harness(),editor=h.open();editor.close();assert.equal(await editor.save(fixture()),false);assert.equal(h.queries.length,0);assert.equal(h.render().listing,null);h.stop();
});
test('late successful update cannot change cards or close an editor after dashboard disposal',async()=>{
 const pending=deferred(),h=harness({reply:()=>pending.promise}),work=h.open().save(fixture());await tick();h.stop();const n=h.writes.length;pending.resolve({data:saved(),error:null});assert.equal(await work,false);assert.equal(h.updates.length,0);assert.equal(h.writes.length,n);
});
test('account change during session lookup prevents any new update',async()=>{
 const pending=deferred(),h=harness({auth:()=>pending.promise}),work=h.open().save(fixture());h.render('B');const n=h.writes.length;pending.resolve(session('A'));assert.equal(await work,false);assert.equal(h.queries.length,0);assert.equal(h.writes.length,n);h.stop();
});
test('unmount or close during lookup prevents updates even if the transport ignores cancellation',async()=>{
 for(const kind of ['close','unmount']){const pending=deferred(),h=harness({auth:()=>pending.promise}),editor=h.open(),work=editor.save(fixture());if(kind==='close')editor.close();else h.stop();const n=h.writes.length;pending.resolve(session('A'));assert.equal(await work,false);assert.equal(h.queries.length,0);assert.equal(h.writes.length,n);h.stop();}
});
test('account change clears private editor state immediately and A-B-A cannot revive it',async()=>{
 const h=harness(),old=h.open();assert.equal(h.render('B').listing,null);h.render('A');old.open(fixture());old.close();assert.equal(await old.save(fixture()),false);assert.equal(h.render().listing,null);assert.equal(h.queries.length,0);h.stop();
});
test('same or different listing replacement rejects old save and close callbacks',async()=>{
 for(const id of [7,8]){const h=harness({reply:async()=>({data:saved(id),error:null})}),old=h.open();old.open(fixture(id));const newer=h.render();assert.notEqual(newer.requestKey,old.requestKey);old.close();assert.equal(await old.save(fixture()),false);assert.equal(h.render().listing.rawId,id);assert.equal(await newer.save(fixture(id)),true);assert.equal(h.queries[0].filters[0][1],id);h.stop();}
});
test('late success or failure for a replaced editor never touches the new editor',async()=>{
 for(const fail of [false,true]){const pending=deferred(),h=harness({reply:()=>pending.promise}),old=h.open(),work=old.save(fixture());await tick();h.render().open(fixture(8));h.render();const n=h.writes.length;if(fail)pending.reject(Error('OLD PRIVATE ERROR'));else pending.resolve({data:saved(),error:null});assert.equal(await work,false);assert.equal(h.updates.length,0);assert.equal(h.writes.length,n);assert.equal(h.render().listing.rawId,8);h.stop();}
});
test('successful save filters by original ID and Host, selects bounded fields and uses server values',async()=>{
 const h=harness(),editor=h.open();assert.equal(await editor.save({...fixture(),price:13,description:'Client description'}),true);assert.deepEqual(h.queries[0].filters,[['id',7],['host_id','A']]);assert.equal(h.queries[0].select,'id,price,description,features,spots,spaces');assert.deepEqual(Object.keys(h.queries[0].payload).sort(),['description','features','price','spaces','spots']);assert.equal(h.updates[0].id,'db-7');assert.equal(h.updates[0].data.price,13.5);assert.equal(h.updates[0].data.description,'Server description');assert.equal('id' in h.updates[0].data,false);assert.equal(h.render().listing,null);assert.equal(await editor.save(fixture()),false);h.stop();
});
test('database errors, malformed saved rows and mismatched IDs never report success',async()=>{
 for(const result of [{data:null,error:{message:'denied'}},{data:{...saved(),id:8},error:null},{data:{...saved(),price:'bad'},error:null},{data:{...saved(),spaces:0},error:null},{data:{...saved(),features:'bad'},error:null}]){const h=harness({reply:async()=>result}),editor=h.open();await assert.rejects(editor.save(fixture()));assert.equal(h.updates.length,0);assert.ok(h.render().listing);h.stop();}
});
test('current save errors unlock explicit retry without automatic replay',async()=>{
 let calls=0;const h=harness({reply:async()=>++calls===1?{data:null,error:{message:'outage'}}:{data:saved(),error:null}}),editor=h.open();await assert.rejects(editor.save(fixture()),/Refresh/);assert.equal(calls,1);assert.equal(await h.render().save(fixture()),true);assert.equal(calls,2);h.stop();
});
test('payload and editor capture immutable editable fields before session lookup',async()=>{
 const pending=deferred(),h=harness({auth:()=>pending.promise}),input=fixture();h.render().open(input);input.description='CHANGED';input.spots[0].bounds.north=9;const editor=h.render();assert.equal(editor.listing.description,'Old description');assert.equal(editor.listing.spots[0].bounds.north,1);assert.doesNotMatch(JSON.stringify(h.slots),/PRIVATE ADDRESS|PRIVATE PHOTO/);const update={...editor.listing,features:['CCTV'],spots:structuredClone(editor.listing.spots)},work=editor.save(update);update.features.push('Gated');update.spots[0].bounds.north=10;pending.resolve(session('A'));await work;assert.deepEqual(h.queries[0].payload.features,['CCTV']);assert.equal(h.queries[0].payload.spots[0].bounds.north,1);h.stop();
});
test('signed-out, invalid-price and mismatched editor ID cannot start updates',async()=>{
 const h=harness();h.render(null).open(fixture());assert.equal(h.render(null).listing,null);h.render('A');const editor=h.open();await assert.rejects(editor.save({...fixture(),rawId:8}),/selected listing/);await assert.rejects(editor.save({...fixture(),price:'-1'}),/valid hourly rate/);assert.equal(h.queries.length,0);assert.equal(h.authCalls,0);h.stop();
});
test('same-account profile rerender keeps the editor while stale auth results stay silent after unmount',async()=>{
 const h=harness(),editor=h.open();assert.equal(h.render('A').listing,editor.listing);h.stop();const pending=deferred(),other=harness({auth:()=>pending.promise}),work=other.open().save(fixture());other.stop();const n=other.writes.length;pending.reject(Error('auth failed'));assert.equal(await work,false);assert.equal(other.writes.length,n);assert.equal(other.queries.length,0);
});

const modalStart=source.indexOf('function EditListingModal('),modalEnd=source.indexOf('// ─── Transactions',modalStart),compiled=await transform(source.slice(modalStart,modalEnd),{loader:'jsx'});
function find(element,type){if(!element||typeof element!=='object')return null;if(element.type===type)return element;for(const child of React.Children.toArray(element.props?.children)){const hit=find(child,type);if(hit)return hit;}return null;}
function modal({save=async()=>true}={}){
 const states=[],refs=[],effects=[],writes=[],payloads=[];let cursor=0,refCursor=0,current=true,closed=0;const Modal=()=>null,Btn=()=>null;
 const values={React,C:{},Modal,Btn,DrivewaySpotMap:()=>null,LISTING_FEATURE_OPTIONS:[],validateHourlyRate,useState:initial=>{const n=cursor++;if(!(n in states))states[n]=typeof initial==='function'?initial():initial;return [states[n],v=>{writes.push(n);states[n]=typeof v==='function'?v(states[n]):v;}];},useRef:initial=>refs[refCursor++]||(refs[refCursor-1]={current:initial}),useEffect:fn=>effects.push(fn)};
 const Component=new Function(...Object.keys(values),compiled.code+';return EditListingModal;')(...Object.values(values));const render=()=>{cursor=0;refCursor=0;return Component({listing:fixture(),onClose:()=>{closed++;},isContextCurrent:()=>current,onSave:payload=>{payloads.push(payload);return save(payload);}});};render();const cleanups=effects.splice(0).map(fn=>fn());return {render,states,payloads,writes,get closed(){return closed;},save:()=>find(render(),Btn).props.onClick(),close:()=>find(render(),Modal).props.onClose(),invalidate:()=>{current=false;},stop:()=>{for(const fn of cleanups)fn?.();}};
}
test('actual editor locks rapid Save clicks before render and preserves spot geometry',async()=>{
 const pending=deferred(),h=modal({save:()=>pending.promise}),one=h.save(),two=h.save();assert.equal(h.payloads.length,1);assert.equal(h.payloads[0].spots[0].id,'A');assert.deepEqual(h.payloads[0].spots[0].bounds,{north:1,south:0,east:1,west:0});pending.resolve(true);await Promise.all([one,two]);assert.equal(h.closed,1);h.stop();
});
test('actual editor catches save errors, shows an alert and unlocks without closing',async()=>{
 const h=modal({save:async()=>{throw Error('Save not confirmed');}});await h.save();assert.equal(h.closed,0);assert.equal(h.states[5],false);assert.ok(JSON.stringify(h.render()).includes('Save not confirmed'));assert.ok(JSON.stringify(h.render()).includes('"role":"alert"'));await h.save();assert.equal(h.payloads.length,2);h.stop();
});
test('actual editor ignores late save success/error after close, invalidation or effect cleanup',async()=>{
 for(const how of ['close','context','unmount'])for(const fail of [false,true]){const pending=deferred(),h=modal({save:()=>pending.promise}),work=h.save();if(how==='close')h.close();else if(how==='context')h.invalidate();else h.stop();const n=h.writes.length;if(fail)pending.reject(Error('OLD PRIVATE ERROR'));else pending.resolve(true);await work;assert.equal(h.writes.length,n);assert.equal(h.closed,how==='close'?1:0);h.stop();}
});
test('actual editor validates rate and rentable spots before starting save',async()=>{
 for(const [index,value] of [[0,'-1'],[4,[false]]]){const h=modal();h.states[index]=value;await h.save();assert.equal(h.payloads.length,0);assert.equal(h.closed,0);assert.ok(h.states[6]);h.stop();}
});
test('actual Host binding applies only saved fields and keys each editor with scoped handlers',async()=>{
 const start=source.indexOf('  const { listing: editingListing'),end=source.indexOf('\n    });',start)+8;let args,rows;
 const props={listing:fixture(),requestKey:7,open:()=>{},close:()=>{},save:()=>{},isCurrent:()=>true};
 const bindings=new Function('useHostListingEdit','user','setDbListings',source.slice(start,end)+';return {editingListing,editingKey,openListingEdit,closeListingEdit,saveListingEdit,isListingEditCurrent};')((...values)=>{args=values;return props;},{id:'A'},fn=>{rows=fn([fixture(7),fixture(8)]);});args[1]('db-7',{price:13.5});assert.equal(rows[0].price,13.5);assert.equal(rows[1].price,12);assert.equal(rows[0].id,'db-7');const x=source.indexOf('<EditListingModal\n'),tag=source.slice(x,source.indexOf('/>',x)+2),built=await transform('function Parent(){return '+tag+';}',{loader:'jsx'});const values={React,EditListingModal:()=>null,...bindings},element=new Function(...Object.keys(values),built.code+';return Parent;')(...Object.values(values))();assert.equal(element.key,'7');assert.equal(element.props.onSave,props.save);assert.equal(element.props.onClose,props.close);assert.equal(element.props.isContextCurrent,props.isCurrent);assert.match(source,/openListingEdit\(l\)/);
});
