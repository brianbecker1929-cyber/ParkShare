import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {validateDriverProfile,getDriverProfileCompletion,MAX_GUEST_VEHICLES,normaliseDriverProfile} from '../src/lib/driverProfile.js';
import {VEHICLE_MAKES,VEHICLE_MODELS,VEHICLE_COLOURS} from '../src/lib/vehicleOptions.js';
const source=await readFile(process.env.QA_PROFILE_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const start=source.indexOf('function VehicleProfileFields('),end=source.indexOf('// ─── Sign In Modal',start);
const compiled=await transform(source.slice(start,end),{loader:'jsx'});
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const user=(id='A')=>({id,role:'driver',name:id+' Driver',phone:'4165550100',email:id+'@example.invalid',vehicleMake:'Honda',vehicleModel:'Accord',vehicleColour:'Blue',licensePlate:id+' 123',guestVehicles:[]});
const session=id=>({data:{session:id?{user:{id},access_token:id+'-token'}:null},error:null});
const response=(profile=normaliseDriverProfile(user()))=>({ok:true,json:async()=>({profile,completion:getDriverProfileCompletion(profile)})});
function nodes(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);for(const child of React.Children.toArray(node.props?.children))nodes(child,predicate,out);return out;}
function harness({auth=async()=>session('A'),refresh=async()=>session('A'),patch=async()=>response()}={}){
 const slots=[],effects=[],setups=[],writes=[],requests=[],updates=[],authReads=[],refreshes=[];let cursor=0,dirty=false,props={user:user()},tree;
 const values={React,C:{},MAX_GUEST_VEHICLES,VEHICLE_MAKES,VEHICLE_MODELS,VEHICLE_COLOURS,validateDriverProfile,getDriverProfileCompletion,VehicleBadge:()=>null,formatVehicleVisualSummary:()=>'',supabase:{auth:{getSession:()=>{authReads.push(true);return auth(authReads.length);},refreshSession:()=>{refreshes.push(true);return refresh(refreshes.length);}}},fetch:async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return patch(url,options);},console:{warn:()=>{}},useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;dirty=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();setups[n]=fn;});}}};
 const Components=new Function(...Object.keys(values),compiled.code+';return {View:DriverProfileView,VehicleProfileFields};')(...Object.values(values));
 function render(changes={}){props={...props,...changes};let count=0;do{dirty=false;cursor=0;tree=Components.View({...props,onProfileUpdated:profile=>updates.push(profile)});for(const fn of effects.splice(0))fn();assert.ok(++count<8);}while(dirty);return tree;}
 const find=(predicate)=>{const result=nodes(render(),predicate)[0];assert.ok(result,'control exists');return result;};
 const button=text=>find(n=>n.type==='button'&&React.Children.toArray(n.props.children).includes(text));
 const input=(name,value)=>find(n=>n.props?.id==='driver-profile-'+name).props.onChange({target:{value}});
 const save=()=>button('Save profile').props.onClick();
 const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
 const replay=()=>{for(const [n,fn] of setups.entries())if(fn){slots[n].cleanup?.();slots[n].cleanup=fn();}render();};
 render();return {render,save,input,stop,replay,button,find,requests,updates,writes,slots,authReads,refreshes,Components,get text(){return JSON.stringify(render());}};
}
test('profile save refuses another session owner before PATCH',async()=>{
 const h=harness({auth:async()=>session('B')});await h.save();assert.equal(h.requests.length,0);assert.equal(h.updates.length,0);assert.match(h.text,/account changed|expired/i);h.stop();
});
test('rapid profile saves issue one pending PATCH before React renders',async()=>{
 const pending=later(),h=harness({patch:()=>pending.promise}),save=h.button('Save profile').props.onClick,a=save(),b=save();await tick();assert.equal(h.requests.length,1);pending.resolve(response());await Promise.all([a,b]);assert.equal(h.updates.length,1);assert.equal(h.refreshes.length,1);h.stop();
});
test('unmount during session lookup prevents a new PATCH and all late state writes',async()=>{
 const pending=later(),h=harness({auth:()=>pending.promise}),work=h.save();h.stop();const count=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.updates.length,0);assert.equal(h.writes.length,count);
});
test('late PATCH success or failure after disposal cannot refresh or restore an account',async()=>{
 for(const fail of [false,true]){const pending=later(),h=harness({patch:()=>pending.promise}),work=h.save();await tick();h.stop();const count=h.writes.length;if(fail)pending.reject(Error('OLD PRIVATE ERROR'));else pending.resolve(response());await assert.doesNotReject(work);assert.equal(h.refreshes.length,0);assert.equal(h.updates.length,0);assert.equal(h.writes.length,count);}
});
test('an account change during lookup including A-B-A invalidates the original attempt',async()=>{
 const pending=later(),h=harness({auth:()=>pending.promise}),work=h.save();h.render({user:user('B')});h.render({user:user('A')});const count=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.updates.length,0);assert.equal(h.writes.length,count);h.stop();
});
test('a hidden account switch after PATCH prevents refreshing that different account',async()=>{
 const h=harness({auth:async n=>session(n===1?'A':'B')});await h.save();assert.equal(h.requests.length,1);assert.equal(h.refreshes.length,0);assert.equal(h.updates.length,0);assert.match(h.text,/profile was saved/);assert.doesNotMatch(h.text,/Profile saved successfully/);h.stop();
});
test('refresh response and final stored session must still belong to the original Driver',async()=>{
 for(const where of ['refresh','final']){const h=harness({auth:async n=>session(where==='final'&&n===3?'B':'A'),refresh:async()=>session(where==='refresh'?'B':'A')});await h.save();assert.equal(h.requests.length,1);assert.equal(h.updates.length,0);assert.match(h.text,/profile was saved/);assert.doesNotMatch(h.text,/Profile saved successfully/);h.stop();}
});
test('unmount during refresh ignores its late session and does not publish old profile fields',async()=>{
 const pending=later(),h=harness({refresh:()=>pending.promise}),work=h.save();await tick();assert.equal(h.refreshes.length,1);h.stop();const count=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.updates.length,0);assert.equal(h.writes.length,count);
});
test('refresh failure distinguishes a saved profile from an unconfirmed session',async()=>{
 for(const fail of [false,true]){const h=harness({refresh:async()=>{if(fail)throw Error('Synthetic refresh outage');return {data:{session:null},error:Error('Expired')};}});await h.save();assert.equal(h.updates.length,0);assert.match(h.text,/profile was saved/);assert.equal(h.button('Save profile').props.disabled,false);h.stop();}
});
test('successful save uses only canonical profile fields and recomputes completion',async()=>{
 const canonical={...normaliseDriverProfile(user()),name:'Server Driver',phone:''};const h=harness({patch:async()=>({ok:true,json:async()=>({profile:{...canonical,id:'B',role:'host',privateField:'DROP'},completion:{complete:true}})})});await h.save();assert.equal(h.updates.length,1);assert.deepEqual(h.updates[0],{id:'A',...canonical,profileComplete:false});assert.equal(h.requests[0].url,'/api/profile');assert.equal(h.requests[0].options.method,'PATCH');assert.equal(h.requests[0].options.headers.Authorization,'Bearer A-token');assert.equal('id' in h.requests[0].body,false);assert.equal(h.authReads.length,3);assert.match(h.text,/Profile saved successfully/);h.stop();
});
test('missing or malformed success payload never clears the draft or reports success',async()=>{
 for(const value of [{},{profile:{name:'Valid name'}},{profile:{...normaliseDriverProfile(user()),guestVehicles:'invalid'}},{profile:{...normaliseDriverProfile(user()),name:''}}]){const h=harness({patch:async()=>({ok:true,json:async()=>value})});await h.save();assert.equal(h.updates.length,0);assert.equal(h.refreshes.length,0);assert.match(h.text,/confirm your saved profile/);assert.equal(h.find(n=>n.props?.id==='driver-profile-name').props.value,'A Driver');h.stop();}
});
test('HTTP field errors remain visible and an explicit retry can succeed',async()=>{
 let count=0;const h=harness({patch:async()=>++count===1?{ok:false,json:async()=>({error:'Check these fields',errors:{phone:'Invalid phone'}})}:response()});await h.save();assert.equal(h.updates.length,0);assert.match(h.text,/Invalid phone/);assert.equal(h.button('Save profile').props.disabled,false);await h.save();assert.equal(count,2);assert.equal(h.updates.length,1);h.stop();
});
test('authentication and network failures unlock without an automatic replay',async()=>{
 for(const where of ['auth','patch','json']){let attempts=0;const h=harness({auth:async()=>{if(where==='auth'&&attempts++===0)throw Error('Auth outage');return session('A');},patch:async()=>{if(where==='auth')return response();if(attempts++===0){if(where==='patch')throw Error('Network outage');return {ok:true,json:async()=>{throw Error('Bad JSON');}};}return response();}});await assert.doesNotReject(h.save());assert.equal(h.updates.length,0);assert.equal(h.button('Save profile').props.disabled,false);await h.save();assert.equal(h.updates.length,1);h.stop();}
});
test('pending save locks draft controls and captures the original normalized guest vehicle',async()=>{
 const pending=later(),h=harness({auth:()=>pending.promise});const guest={id:'friend',vehicleMake:'Toyota',vehicleModel:'RAV4',vehicleColour:'Red',licensePlate:'GUEST 12'};h.render({user:{...user(),guestVehicles:[guest]}});const work=h.save();h.input('name','Changed during save');guest.licensePlate='MUTATED';assert.equal(h.find(n=>n.props?.id==='driver-profile-name').props.value,'A Driver');assert.equal(h.find(n=>n.props?.id==='driver-profile-name').props.disabled,true);assert.equal(h.find(n=>n.props?.className==='ps-add-guest-vehicle').props.disabled,true);const fields=h.find(n=>n.type===h.Components.VehicleProfileFields);assert.equal(fields.props.disabled,true);const controls=nodes(h.Components.VehicleProfileFields(fields.props),n=>n.type==='select'||n.type==='input');assert.ok(controls.every(n=>n.props.disabled));pending.resolve(session('A'));await work;assert.equal(h.requests[0].body.guestVehicles[0].licensePlate,'GUEST 12');assert.equal(h.requests[0].body.name,'A Driver');h.stop();
});
test('invalid name remains editable and does not start a request',async()=>{
 const h=harness();h.input('name','X');await h.save();assert.equal(h.requests.length,0);assert.equal(h.authReads.length,0);assert.match(h.text,/Enter your full name/);assert.equal(h.find(n=>n.props?.id==='driver-profile-name').props.disabled,false);h.stop();
});
test('StrictMode cleanup/setup invalidates pending work and leaves the form usable',async()=>{
 const pending=later();let reads=0;const h=harness({auth:async()=>++reads===1?pending.promise:session('A')}),work=h.save();h.replay();pending.resolve(session('A'));await work;assert.equal(h.requests.length,0);await h.save();assert.equal(h.updates.length,1);h.stop();
});
test('root profile key isolates account drafts and functional update cannot restore a signed-out or different account',async()=>{
 const tag=source.match(/<DriverProfileView\b[\s\S]*?\/>/)[0],code=await transform('function Parent(){return '+tag+';}',{loader:'jsx'});let callback;const values={React,DriverProfileView:()=>null,user:user(),setUser:fn=>{callback=fn;}};const element=new Function(...Object.keys(values),code.code+';return Parent();')(...Object.values(values));assert.equal(element.key,'A');const update={id:'A',name:'Saved Driver',profileComplete:true};element.props.onProfileUpdated(update);assert.equal(typeof callback,'function');assert.equal(callback(null),null);const b=user('B');assert.equal(callback(b),b);assert.deepEqual(callback(user()),{...user(),...update});
});

test('invalid guest vehicle validation opens its section and sends no request',async()=>{
 const h=harness();h.render({user:{...user(),guestVehicles:[{id:'invalid-guest',vehicleMake:'Honda',vehicleModel:'',vehicleColour:'',licensePlate:''}]}});await h.save();assert.equal(h.requests.length,0);assert.equal(h.authReads.length,0);const guest=h.find(n=>n.type===h.Components.VehicleProfileFields&&n.props.errorPrefix==='guestVehicles.0');assert.ok(guest.props.errors['guestVehicles.0.vehicleModel']);h.stop();
});
