import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {getListingSpotLayout} from '../src/lib/listingSpotLayout.js';
import {canChooseListingSpot,availabilityRequestKey,listingSpotStatusText} from '../src/lib/spotAvailability.js';
import {getBookableVehicles} from '../src/lib/driverProfile.js';
import {futureBookingDate,localCalendarDate} from '../src/lib/bookingCalendarDate.js';
import {calculateBookingAmounts} from '../api/_booking-rules.js';
const source=await readFile(process.env.QA_SPOT_LAYOUT_APP||new URL('../src/App.jsx',import.meta.url),'utf8');
const compiledPicker=await transform(source.slice(source.indexOf('function SpotPicker('),source.indexOf('// Read-only booking view shared')),{loader:'jsx'});
const compiledDetail=await transform(source.slice(source.indexOf('function ListingDetail('),source.indexOf('// The email opens the actual booked listing')).replaceAll('import.meta.env.VITE_GOOGLE_MAPS_API_KEY','false'),{loader:'jsx'});
const C={navy:'#0E1B2E',moss:'#42865b',muted:'#666',hazard:'#e2571c',concrete:'#eee'};
function walk(node,out=[]){if(!node||typeof node!=='object')return out;out.push(node);for(const child of React.Children.toArray(node.props?.children))walk(child,out);return out;}
function picker(props){
 const values={React,C,getListingSpotLayout,canChooseListingSpot,listingSpotStatusText,DrivewayFrame:({children})=>React.createElement('div',null,children),hasDrivewayVehicle:value=>!!value,DrivewayCarVisual:()=>React.createElement('span',null,'SAVED VEHICLE')};
 const Picker=new Function(...Object.keys(values),compiledPicker.code+';return SpotPicker;')(...Object.values(values));return Picker(props);
}
const open=count=>({available:true,hostScheduleOpen:true,spacesTotal:count,spacesFree:count,spotStatus:Object.fromEntries(Array.from({length:count},(_,i)=>[String.fromCharCode(65+i),true]))});
for(const count of [1,2,3,4,6,8])test(`picker shows exactly ${count} physical bays without invented or hidden spots`,()=>{
 for(const configured of [false,true]){
  const layout=getListingSpotLayout({spaces:count,spots:configured?Array.from({length:count},()=>({forRent:true})):[]});
  const tree=picker({availableCount:count,spotStates:layout.map(spot=>spot.forRent),chosen:null,isRealListing:true,availableData:open(count)});
  const bays=walk(tree).filter(node=>node.type==='button');assert.equal(bays.length,count);
  const html=renderToStaticMarkup(tree);for(let i=0;i<count;i++)assert.ok(html.includes(`Spot ${String.fromCharCode(65+i)}`));assert.ok(!html.includes(`Spot ${String.fromCharCode(65+count)}`));
  const grid=walk(tree).find(node=>node.props?.style?.display==='grid');assert.equal(grid.props.style.gridTemplateRows,`repeat(${Math.ceil(count/(count===1?1:2))}, minmax(0, 1fr))`);
 }
});
test('private bays retain labels and rentable E/H retain their physical click indexes',()=>{
 const flags=[false,true,false,true,true,false,true,true],calls=[];
 const layout=getListingSpotLayout({spaces:5,spots:flags.map(forRent=>({forRent}))});assert.deepEqual(layout.map(spot=>spot.label),['A','B','C','D','E','F','G','H']);
 const bays=walk(picker({availableCount:5,spotStates:flags,isRealListing:true,availableData:open(8),chosen:null,onChoose:index=>calls.push(index)})).filter(node=>node.type==='button');
 assert.equal(bays.length,8);assert.equal(bays[0].props.disabled,true);bays[0].props.onClick();bays[4].props.onClick();bays[7].props.onClick();assert.deepEqual(calls,[4,7]);
});
test('invalid capacities never invent bays; explicit private configuration overrides capacity',()=>{
 for(const spaces of [null,undefined,0,-1,1.5,'invalid',Infinity])assert.deepEqual(getListingSpotLayout({spaces}),[]);
 assert.equal(getListingSpotLayout({spaces:'3'}).length,3);assert.equal(getListingSpotLayout({spaces:99999}).length,8);
 assert.deepEqual(getListingSpotLayout({spaces:8,spots:[{forRent:false},{forRent:'true'}]}).map(spot=>spot.forRent),[false,false]);
});
test('all eight bays require verified availability; held and private bays stay blocked',()=>{
 for(const availableData of [null,{}, {available:true},{...open(8),hostScheduleOpen:false}])assert.ok(walk(picker({availableCount:8,chosen:null,isRealListing:true,availableData})).filter(node=>node.type==='button').every(bay=>bay.props.disabled));
 const data=open(8);data.spotStatus.E=false;data.spotState={E:'held'};const bays=walk(picker({availableCount:8,chosen:4,vehicle:{},isRealListing:true,availableData:data})).filter(node=>node.type==='button');assert.equal(bays[4].props.disabled,true);assert.equal(bays[7].props.disabled,false);
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function detailHarness({count=4,flags,fetcher}={}){
 const slots=[],effects=[],requests=[],intervals=new Map();let cursor=0,dirty=false,tree,timerId=0;
 const props={listing:{id:'db-7',spaces:flags?flags.filter(Boolean).length:count,spots:flags?.map(forRent=>({forRent}))||[],title:'Synthetic layout',price:12,features:[],timeZone:'America/Toronto'},user:{id:'driver',vehicleMake:'Honda',vehicleModel:'Accord',vehicleColour:'Blue',licensePlate:'QA 250'}};
 const values={React,C,getListingSpotLayout,canChooseListingSpot,availabilityRequestKey,getBookableVehicles,futureBookingDate,localCalendarDate,calculateBookingAmounts,
  getEventParkingSuggestion:()=>null,isListingImageUrl:()=>false,formatVehicleVisualSummary:()=>'Saved primary vehicle',formatAvailabilitySummary:()=>'Open',formatHour:value=>String(value),money:value=>`$${value.toFixed(2)}`,bookingCheckoutKey:({chosenSpot,date})=>`${chosenSpot}:${date}`,HOUR_OPTIONS:[9,10,11],END_HOUR_OPTIONS:[10,11,12],
  window:{setInterval:fn=>{intervals.set(++timerId,fn);return timerId;},clearInterval:id=>intervals.delete(id),addEventListener(){},removeEventListener(){}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},
  fetch:async(url,options)=>{requests.push({url,options});if(fetcher)return fetcher(url,options);const scheduled=new URL(url,'https://fixture.invalid').searchParams.has('bookingDate');const state=open(count);if(!scheduled){state.available=false;state.spacesFree=0;for(const label of Object.keys(state.spotStatus))state.spotStatus[label]=false;}return {ok:true,json:async()=>state};},
  useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,update=>{const value=typeof update==='function'?update(slots[n].value):update;if(value!==slots[n].value){slots[n].value=value;dirty=true;}}];},
  useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},
  useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((value,i)=>value!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();});}}};
 for(const name of ['ListingThumb','PriceTag','WalkingTimeLabel','Badge','Btn','EventDestinationSummary','SpotMapBoundary','ListingSatelliteView','RidesharePickupCard','Modal','MiniCalendar','SpotPicker','VehicleBadge','ReviewsSection','PaymentModal'])values[name]=function Component(){return null;};
 const Detail=new Function(...Object.keys(values),compiledDetail.code+';return ListingDetail;')(...Object.values(values));
 function render(changes={}){Object.assign(props,changes);let guard=0;do{dirty=false;cursor=0;tree=Detail(props);for(const fn of effects.splice(0))fn();assert.ok(++guard<15,'Effects settle');}while(dirty);return tree;}
 const find=predicate=>{const hit=walk(render()).find(predicate);assert.ok(hit,'Expected live control');return hit;};render();
 return {render,find,requests,values,props,flush:async()=>{await tick();render();},stop:()=>{for(const slot of slots)slot?.cleanup?.();},later:()=>find(node=>node.props?.className==='ps-spot-schedule-later').props.onClick(),choose:index=>find(node=>node.type===values.SpotPicker).props.onChoose(index),pay:()=>find(node=>node.type===values.Btn&&node.props.children==='Reserve & pay →')};
}
for(const count of [4,6,8])test(`full current ${count}-bay listing can select a future slot and open payment with the exact bay/date/vehicle`,async()=>{
 const h=detailHarness({count});await h.flush();assert.equal(h.pay().props.disabled,true);h.later();h.render();assert.equal(walk(h.render()).some(node=>node.type===h.values.Modal),false,'Picker closes so date/time controls are accessible');assert.equal(h.pay().props.disabled,true,'Stale full-now result cannot unlock the future window');
 await h.flush();assert.ok(h.requests.some(request=>request.url.includes('bookingDate=')));h.find(node=>node.type==='button'&&node.props.children==='Choose spot').props.onClick();h.choose(count-1);h.render();assert.equal(h.pay().props.disabled,false);h.pay().props.onClick();const payment=h.find(node=>node.type===h.values.PaymentModal);
 assert.equal(payment.props.chosenSpot,count-1);assert.equal(payment.props.selectedVehicleId,'primary');assert.equal(payment.props.startHour,9);assert.equal(payment.props.endHour,11);assert.equal(payment.props.hours,2);assert.equal(localCalendarDate(payment.props.date),new URL(h.requests.at(-1).url,'https://fixture.invalid').searchParams.get('bookingDate'));h.stop();
});
test('detail selection blocks private holes while permitting E/H without renumbering',async()=>{
 const h=detailHarness({count:8,flags:[false,true,false,false,true,false,false,true]});await h.flush();h.later();h.render();await h.flush();h.find(node=>node.type==='button'&&node.props.children==='Choose spot').props.onClick();h.choose(0);h.render();assert.equal(h.pay().props.disabled,true);h.choose(4);h.render();assert.equal(h.pay().props.disabled,false);h.choose(7);h.pay().props.onClick();assert.equal(h.find(node=>node.type===h.values.PaymentModal).props.chosenSpot,7);h.stop();
});
test('a late full-now response cannot overwrite the selected future window',async()=>{
 const pending=[],h=detailHarness({count:4,fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});h.later();h.render();const future=pending.find(request=>request.url.includes('bookingDate='));assert.ok(future);future.resolve({ok:true,json:async()=>open(4)});await h.flush();
 for(const request of pending.filter(request=>!request.url.includes('bookingDate=')))request.resolve({ok:true,json:async()=>({available:false,spotStatus:{A:false}})});await h.flush();h.find(node=>node.type==='button'&&node.props.children==='Choose spot').props.onClick();h.choose(3);h.render();assert.equal(h.pay().props.disabled,false);h.stop();
});
