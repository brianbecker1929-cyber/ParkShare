import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {getBookableVehicles} from '../src/lib/driverProfile.js';
import {validId} from '../src/lib/privateListingAccess.js';
import {localCalendarDate} from '../src/lib/bookingCalendarDate.js';
import {calculateBookingAmounts} from '../api/_booking-rules.js';
import {getListingSpotLayout} from '../src/lib/listingSpotLayout.js';
const source=await readFile(process.env.QA_CHECKOUT_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const a=source.includes('function bookingCheckoutKey(')?source.indexOf('function bookingCheckoutKey('):source.indexOf('function PaymentModal(');
const compiled=await transform(source.slice(a,source.indexOf('// ─── Reviews Section',a)),{loader:'jsx'});
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const user=(id='A')=>({id,name:id+' Driver',vehicleMake:'Honda',vehicleModel:'Accord',vehicleColour:'Blue',licensePlate:id+' 123',guestVehicles:[{id:'friend',vehicleMake:'Toyota',vehicleModel:'RAV4',vehicleColour:'Red',licensePlate:'GUEST 12'}]});
const session=id=>({data:{session:id?{user:{id},access_token:id+'-token'}:null},error:null});
const response=()=>({ok:true,status:200,json:async()=>({url:'https://checkout.stripe.com/synthetic-only'})});
function nodes(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);for(const child of React.Children.toArray(node.props?.children))nodes(child,predicate,out);return out;}
function harness({auth=async()=>session('A'),refresh=async()=>session('A'),post=async()=>response()}={}){
 const slots=[],effects=[],setups=[],writes=[],requests=[],redirects=[],vehicles=[],authReads=[],refreshes=[];let cursor=0,dirty=false,tree,closed=0,successes=0;
 let props={listing:{id:'db-7',title:'Synthetic parking',price:12,spaces:4,address:'Public fixture'},hours:2,chosenSpot:1,date:new Date(2030,9,20),startHour:9,endHour:11,selectedEvent:{id:23},user:user(),selectedVehicleId:'primary'};
 const Modal=()=>null,Btn=()=>null;
 const values={React,C:{},Modal,Btn,ListingThumb:()=>null,VehicleBadge:()=>null,SpotPicker:()=>null,EventDestinationSummary:()=>null,formatHour:x=>String(x),money:x=>'$'+Number(x).toFixed(2),formatVehicleVisualSummary:()=>'',getBookableVehicles,validId,localCalendarDate,calculateBookingAmounts,console:{error:()=>{}},window:{location:{assign:url=>redirects.push(url)}},supabase:{auth:{getSession:()=>{authReads.push(true);return auth(authReads.length);},refreshSession:()=>{refreshes.push(true);return refresh(refreshes.length);}}},fetch:async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return post(url,options);},useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;dirty=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();setups[n]=fn;});}}};
 values.getListingSpotLayout=getListingSpotLayout;
 const funcs=new Function(...Object.keys(values),compiled.code+';return {PaymentModal,key:typeof bookingCheckoutKey==="function"?bookingCheckoutKey:null};')(...Object.values(values));
 function render(changes={}){props={...props,...changes};let count=0;do{dirty=false;cursor=0;tree=funcs.PaymentModal({...props,onClose:()=>closed++,onSuccess:()=>successes++,onVehicleChange:id=>vehicles.push(id)});for(const fn of effects.splice(0))fn();assert.ok(++count<8);}while(dirty);return tree;}
 const find=predicate=>{const hit=nodes(render(),predicate)[0];assert.ok(hit,'control exists');return hit;};
 const pay=()=>find(n=>n.type===Btn).props.onClick();
 const close=()=>find(n=>n.type===Modal).props.onClose();
 const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
 const replay=()=>{for(const [n,fn] of setups.entries())if(fn){slots[n].cleanup?.();slots[n].cleanup=fn();}render();};
 render();return {render,find,pay,close,stop,replay,requests,redirects,vehicles,writes,authReads,refreshes,key:funcs.key,get props(){return props;},get closed(){return closed;},get successes(){return successes;},get text(){return JSON.stringify(render());}};
}
test('checkout rejects a different session owner before creating a hold/session',async()=>{
 const h=harness({auth:async()=>session('B')});await h.pay();assert.equal(h.requests.length,0);assert.equal(h.refreshes.length,0);assert.equal(h.redirects.length,0);assert.match(h.text,/account changed/i);h.stop();
});
test('rapid Pay clicks create one pending checkout request before rendering',async()=>{
 const pending=later(),h=harness({post:()=>pending.promise}),pay=h.find(n=>n.type!==undefined&&n.props?.full&&typeof n.props?.children==='string'&&n.props.children.includes('Pay with Stripe')).props.onClick,a=pay(),b=pay();await tick();assert.equal(h.requests.length,1);pending.resolve(response());await Promise.all([a,b]);assert.equal(h.redirects.length,1);await pay();assert.equal(h.requests.length,1);h.stop();
});
test('Close invalidates a queued Pay callback immediately before unmount',async()=>{
 const h=harness(),pay=h.find(n=>n.props?.children==='Pay with Stripe →').props.onClick;h.close();await pay();assert.equal(h.closed,1);assert.equal(h.authReads.length,0);assert.equal(h.requests.length,0);h.stop();
});
test('closing or disposing during authentication prevents a subsequent checkout request',async()=>{
 for(const how of ['close','unmount']){const pending=later(),h=harness({auth:()=>pending.promise}),work=h.pay();if(how==='close')h.close();else h.stop();const count=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);assert.equal(h.writes.length,count);h.stop();}
});
test('close during session refresh prevents a POST even when refresh completes',async()=>{
 const pending=later(),h=harness({auth:async()=>session(null),refresh:()=>pending.promise}),work=h.pay();await tick();h.close();const count=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.writes.length,count);h.stop();
});
test('wrong refreshed owner and missing owner/token cannot start checkout',async()=>{
 for(const refreshed of [session('B'),session(null),{data:{session:{access_token:'token'}}}]){const h=harness({auth:async()=>session(null),refresh:async()=>refreshed});await h.pay();assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);h.stop();}
});
test('one successful session refresh preserves the original booking and redirects once',async()=>{
 let calls=0;const h=harness({auth:async()=>++calls===1?session(null):session('A')});await h.pay();assert.equal(h.refreshes.length,1);assert.equal(h.requests.length,1);assert.equal(h.redirects.length,1);assert.equal(h.successes,0,'opening Stripe is not a paid booking');h.stop();
});
test('a hidden account switch before redirect prevents navigation to the old checkout',async()=>{
 const h=harness({auth:async n=>session(n===1?'A':'B')});await h.pay();assert.equal(h.requests.length,1);assert.equal(h.redirects.length,0);assert.match(h.text,/account changed/);h.stop();
});
test('late checkout success/error after Close or unmount cannot redirect or write UI',async()=>{
 for(const how of ['close','unmount'])for(const fail of [false,true]){const pending=later(),h=harness({post:()=>pending.promise}),work=h.pay();await tick();if(how==='close')h.close();else h.stop();const count=h.writes.length;if(fail)pending.reject(Error('OLD ERROR'));else pending.resolve(response());await assert.doesNotReject(work);assert.equal(h.redirects.length,0);assert.equal(h.writes.length,count);h.stop();}
});
test('closing during the final session check suppresses the redirect',async()=>{
 const pending=later(),h=harness({auth:async n=>n===1?session('A'):pending.promise}),work=h.pay();await tick();assert.equal(h.requests.length,1);h.close();const count=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.redirects.length,0);assert.equal(h.writes.length,count);h.stop();
});
test('account A-B-A or selection replacement cannot revive an old checkout lookup',async()=>{
 for(const kind of ['account','listing','hours','spot','day','time','vehicle','event','vehicle-details']){const pending=later(),h=harness({auth:()=>pending.promise}),work=h.pay();const old=h.props;
  const changes={account:{user:user('B')},listing:{listing:{...old.listing,id:'db-8'}},hours:{hours:3},spot:{chosenSpot:2},day:{date:new Date(2030,9,21)},time:{startHour:10,endHour:12},vehicle:{selectedVehicleId:'friend'},event:{selectedEvent:{id:24}},'vehicle-details':{user:{...user(),licensePlate:'UPDATED 1'}}}[kind];h.render(changes);if(kind==='account')h.render({user:user('A')});const count=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.requests.length,0,kind);assert.equal(h.redirects.length,0,kind);assert.equal(h.writes.length,count,kind);h.stop();}
});
test('immutable checkout payload preserves price, vehicle, event and local calendar date',async()=>{
 const pending=later(),h=harness({auth:async n=>n===1?pending.promise:session('A')}),work=h.pay();h.props.listing.id='db-8';h.props.listing.price=99;h.props.date.setDate(21);h.props.selectedEvent.id=88;pending.resolve(session('A'));await work;assert.deepEqual(h.requests[0].body,{listingId:7,hours:2,total:27.6,listingTitle:'Synthetic parking',spotLabel:'B',bookingDate:'2030-10-20',startHour:9,endHour:11,vehicleId:'primary',eventId:23});assert.equal(h.requests[0].options.cache,'no-store');assert.equal(h.requests[0].options.headers.Authorization,'Bearer A-token');h.stop();
});
test('current HTTP/network/auth/JSON failures show an alert and unlock explicit retry',async()=>{
 for(const kind of ['auth','network','http','json','missing-url']){let failures=0;const h=harness({auth:async()=>{if(kind==='auth'&&failures++===0)throw Error('Auth unavailable');return session('A');},post:async()=>{if(kind==='auth')return response();if(failures++===0){if(kind==='network')throw Error('Network unavailable');if(kind==='http')return {ok:false,status:409,json:async()=>({error:'Spot held'})};if(kind==='json')return {ok:true,status:200,json:async()=>{throw Error('Bad JSON');}};return {ok:true,status:200,json:async()=>({})};}return response();}});await assert.doesNotReject(h.pay());assert.equal(h.redirects.length,0);assert.equal(h.find(n=>n.props?.role==='alert').props.role,'alert');assert.equal(h.find(n=>n.props?.children==='Pay with Stripe →').props.disabled,false);await h.pay();assert.equal(h.redirects.length,1);h.stop();}
});
test('vehicle picker remains available while idle and locks both controls during checkout',async()=>{
 const pending=later(),h=harness({post:()=>pending.promise});h.find(n=>n.props?.className==='ps-spot-change-vehicle').props.onClick();const select=h.find(n=>n.props?.role==='radio'&&n.props?.['aria-checked']===false).props.onClick;const work=h.pay();await tick();assert.equal(h.find(n=>n.props?.className==='ps-spot-change-vehicle').props.disabled,true);assert.ok(nodes(h.render(),n=>n.props?.role==='radio').every(n=>n.props.disabled));select();assert.equal(h.vehicles.length,0);pending.resolve({ok:false,status:409,json:async()=>({error:'Spot held'})});await work;assert.equal(h.find(n=>n.props?.className==='ps-spot-change-vehicle').props.disabled,false);h.find(n=>n.props?.role==='radio'&&n.props?.['aria-checked']===false).props.onClick();assert.deepEqual(h.vehicles,['friend']);h.stop();
});
test('same-account profile rerenders with unchanged selection do not discard a valid pending request',async()=>{
 const pending=later(),h=harness({post:()=>pending.promise}),work=h.pay();await tick();h.render({user:{...user(),name:'New display name'}});pending.resolve(response());await work;assert.equal(h.redirects.length,1);h.stop();
});
test('Book Now sends no scheduled date/time and retains the selected spot',async()=>{
 const h=harness();h.render({date:undefined,startHour:undefined,endHour:undefined,selectedEvent:null});await h.pay();const body=h.requests[0].body;assert.equal(body.spotLabel,'B');assert.equal(body.hours,2);assert.equal('bookingDate' in body,false);assert.equal('startHour' in body,false);assert.equal('endHour' in body,false);assert.equal('eventId' in body,false);h.stop();
});
test('unsigned/missing vehicle/invalid real listing cannot submit; demo keeps its separate flow',async()=>{
 for(const changed of [{user:null},{selectedVehicleId:'missing'},{listing:{id:'db-invalid',price:12,title:'Invalid'}},{listing:{id:'demo',price:12,title:'Demo'}}]){const h=harness();h.render(changed);if(changed.listing?.id==='demo'){assert.equal(h.find(n=>n.props?.children==='Continue to payment →').props.disabled,false);}else await h.pay();assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);h.stop();}
});
test('StrictMode replay invalidates old work and leaves a new checkout usable',async()=>{
 const pending=later();let calls=0;const h=harness({auth:async()=>++calls===1?pending.promise:session('A')}),work=h.pay();h.replay();pending.resolve(session('A'));await work;assert.equal(h.requests.length,0);await h.pay();assert.equal(h.requests.length,1);assert.equal(h.redirects.length,1);h.stop();
});
test('actual payment binding keys each dialog to the same original account and booking selection',async()=>{
 const h=harness();assert.ok(h.key);const props=h.props,tag=source.match(/<PaymentModal\b[\s\S]*?\/>/)[0],code=await transform('function Parent(){return '+tag+';}',{loader:'jsx'});const values={React,PaymentModal:()=>null,bookingCheckoutKey:h.key,...props,bookingMode:'advance',setSelectedVehicleId:()=>{},selectedAvailability:null,setShowPayment:()=>{},confirmBooking:()=>{}};const element=new Function(...Object.keys(values),code.code+';return Parent();')(...Object.values(values));assert.equal(element.key,h.key(props));assert.equal(h.key({...props,date:new Date(2030,9,20),user:{...user(),name:'Changed'}}),h.key(props));assert.notEqual(h.key({...props,user:user('B')}),h.key(props));assert.notEqual(h.key({...props,listing:{...props.listing,price:15}}),h.key(props));h.stop();
});

test('actual payment preview preserves the full physical layout for one through eight bays',()=>{
 for(const count of [1,2,3,4,6,8]){
  const h=harness();h.render({listing:{...h.props.listing,spaces:count,spots:[]},chosenSpot:count-1});
  const preview=h.find(node=>Array.isArray(node.props?.spotStates));
  assert.equal(preview.props.spotStates.length,count);assert.equal(preview.props.chosen,count-1);h.stop();
 }
});
for(const [index,label] of [[4,'E'],[7,'H']])test(`checkout for Spot ${label} preserves its physical label, date, vehicle and eight-bay preview`,async()=>{
 const h=harness(),flags=[false,true,false,true,true,false,true,true];
 h.render({listing:{...h.props.listing,spaces:5,spots:flags.map(forRent=>({forRent}))},chosenSpot:index});
 const preview=h.find(node=>Array.isArray(node.props?.spotStates));assert.deepEqual(preview.props.spotStates,flags);
 await h.pay();assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.spotLabel,label);assert.equal(h.requests[0].body.vehicleId,'primary');assert.equal(h.requests[0].body.bookingDate,'2030-10-20');assert.equal(h.redirects.length,1);h.stop();
});
