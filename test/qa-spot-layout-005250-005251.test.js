import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {bookingReadinessMessage} from '../src/lib/bookingReadiness.js';
import {getListingSpotLayout} from '../src/lib/listingSpotLayout.js';
import {canChooseListingSpot,availabilityRequestKey,listingSpotStatusText,listingAvailabilityMessage} from '../src/lib/spotAvailability.js';
import {formatBookNowTimes} from '../src/lib/bookNowTimes.js';
import {getBookableVehicles} from '../src/lib/driverProfile.js';
import {futureBookingDate,localCalendarDate} from '../src/lib/bookingCalendarDate.js';
import {calculateBookingAmounts} from '../api/_booking-rules.js';
import {validateBookingDuration,MAX_BOOKING_HOURS} from '../src/lib/bookingDuration.js';
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
function detailHarness({count=4,flags,fetcher,bookability='ready'}={}){
 const slots=[],effects=[],requests=[],intervals=new Map();let cursor=0,dirty=false,tree,timerId=0;
 const props={listing:{id:'db-7',spaces:flags?flags.filter(Boolean).length:count,spots:flags?.map(forRent=>({forRent}))||[],title:'Synthetic layout',price:12,features:[],timeZone:'America/Toronto'},user:{id:'driver',vehicleMake:'Honda',vehicleModel:'Accord',vehicleColour:'Blue',licensePlate:'QA 250'}};
 const values={React,C,useListingBookability:()=>({status:bookability,retry:()=>{}}),bookingReadinessMessage,getListingSpotLayout,canChooseListingSpot,availabilityRequestKey,listingAvailabilityMessage,formatBookNowTimes,getBookableVehicles,futureBookingDate,localCalendarDate,calculateBookingAmounts,validateBookingDuration,MAX_BOOKING_HOURS,
  getEventParkingSuggestion:()=>null,isListingImageUrl:()=>false,formatVehicleVisualSummary:()=>'Saved primary vehicle',formatAvailabilitySummary:()=>'Open',formatHour:value=>String(value),money:value=>`$${value.toFixed(2)}`,bookingCheckoutKey:({chosenSpot,date})=>`${chosenSpot}:${date}`,HOUR_OPTIONS:Array.from({length:96},(_,i)=>i/4),END_HOUR_OPTIONS:Array.from({length:191},(_,i)=>(i+1)/4),
  window:{setInterval:fn=>{intervals.set(++timerId,fn);return timerId;},clearInterval:id=>intervals.delete(id),addEventListener(){},removeEventListener(){}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},
  fetch:async(url,options)=>{requests.push({url,options});if(fetcher)return fetcher(url,options);const scheduled=new URL(url,'https://fixture.invalid').searchParams.has('bookingDate');const state=open(count);if(!scheduled){state.available=false;state.spacesFree=0;for(const label of Object.keys(state.spotStatus))state.spotStatus[label]=false;}return {ok:true,json:async()=>state};},
  useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,update=>{const value=typeof update==='function'?update(slots[n].value):update;if(value!==slots[n].value){slots[n].value=value;dirty=true;}}];},
  useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},
  useMemo:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((value,i)=>value!==old.deps[i]))slots[n]={deps,value:fn()};return slots[n].value;},
  useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((value,i)=>value!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();});}}};
 for(const name of ['ListingThumb','PriceTag','WalkingTimeLabel','Badge','Btn','EventDestinationSummary','SpotMapBoundary','ListingSatelliteView','RidesharePickupCard','Modal','MiniCalendar','SpotPicker','VehicleBadge','ReviewsSection','PaymentModal','BookingVehicleForm'])values[name]=function Component(){return null;};
 const Detail=new Function(...Object.keys(values),compiledDetail.code+';return ListingDetail;')(...Object.values(values));
 function render(changes={}){Object.assign(props,changes);let guard=0;do{dirty=false;cursor=0;tree=Detail(props);for(const fn of effects.splice(0))fn();assert.ok(++guard<15,'Effects settle');}while(dirty);return tree;}
 const find=predicate=>{const hit=walk(render()).find(predicate);assert.ok(hit,'Expected live control');return hit;};render();
 return {render,find,requests,values,props,setBookability:value=>{bookability=value;render();},flush:async()=>{await tick();render();},stop:()=>{for(const slot of slots)slot?.cleanup?.();},later:()=>find(node=>node.props?.className==='ps-spot-schedule-later').props.onClick(),choose:index=>find(node=>node.type===values.SpotPicker).props.onChoose(index),pay:()=>find(node=>node.type===values.Btn&&node.props.children==='Reserve & pay →')};
}
const switchMode=(h,mode)=>h.find(node=>node.type==='button'&&node.props.children===(mode==='now'?'⚡ Book Now':'📅 Schedule for Later')).props.onClick();
const assertBay=(h,label)=>assert.match(renderToStaticMarkup(h.render()),new RegExp('Spot '+label));
const hasPayment=h=>walk(h.render()).some(node=>node.type===h.values.PaymentModal);

test('BUG-005450 automatic and reopened spot pickers use the native modal and return to Choose spot',async()=>{
 const h=detailHarness({fetcher:async()=>({ok:true,json:async()=>open(4)})});
 try{
  await h.flush();let picker=h.find(node=>node.type===h.values.Modal&&node.props.title.startsWith('Choose your spot'));
  assert.equal(picker.props.nativeModal,true);assert.equal(typeof picker.props.returnFocus,'function');
  picker.props.onClose();assert.equal(walk(h.render()).some(node=>node.type===h.values.Modal),false);
  const trigger=h.find(node=>node.type==='button'&&node.props.children==='Choose spot');const ref=Number(React.version.split('.')[0])>=19?trigger.props.ref:trigger.ref;
  const target={isConnected:true};ref.current=target;trigger.props.onClick();picker=h.find(node=>node.type===h.values.Modal&&node.props.title.startsWith('Choose your spot'));assert.equal(picker.props.nativeModal,true);assert.equal(picker.props.returnFocus(),target);
  h.choose(1);h.render();h.find(node=>node.type===h.values.Btn&&node.props.children==='Confirm Spot B').props.onClick();assert.equal(walk(h.render()).some(node=>node.type===h.values.Modal),false);assert.equal(h.pay().props.disabled,false);
 }finally{h.stop();}
});

test('BUG-005463 the reported 12:30-13:15 window explains the one-hour minimum before availability or payment',async()=>{
 const h=detailHarness({fetcher:async()=>({ok:true,json:async()=>open(4)})});
 try{
  await h.flush();switchMode(h,'advance');h.render();await h.flush();
  h.find(node=>node.type==='select'&&node.props.value===9).props.onChange({target:{value:'12.5'}});h.render();await h.flush();h.choose(1);h.render();assert.equal(h.pay().props.disabled,false);const before=h.requests.length;
  h.find(node=>node.type==='select'&&node.props.value===13.5).props.onChange({target:{value:'13.25'}});h.render();await h.flush();
  const start=h.find(node=>node.type==='select'&&node.props.value===12.5),end=h.find(node=>node.type==='select'&&node.props.value===13.25);
  for(const control of [start,end]){assert.equal(control.props['aria-invalid'],true);assert.equal(control.props['aria-describedby'],'booking-schedule-error');}
  assert.equal(h.requests.length,before,'No availability query for an invalid window');assert.equal(h.pay().props.disabled,true);h.pay().props.onClick();assert.equal(hasPayment(h),false);
  const tree=h.render(),html=renderToStaticMarkup(tree);assert.match(html,/minimum booking length is 1 hour/);assert.match(html,/Adjust the start or end time/);assert.match(html,/id="booking-schedule-error" role="alert"/);assert.doesNotMatch(html,/1 hour total/);
  const quote=walk(tree).find(node=>node.props?.className==='ps-booking-reserve-row');assert.doesNotMatch(renderToStaticMarkup(quote),/\$/);
 }finally{h.stop();}
});
test('BUG-005463 correcting a short scheduled window sends exact one-hour and quarter-hour durations',async()=>{
 const h=detailHarness({fetcher:async()=>({ok:true,json:async()=>open(4)})});
 try{
  await h.flush();switchMode(h,'advance');h.render();await h.flush();h.find(node=>node.type==='select'&&node.props.value===9).props.onChange({target:{value:'12.5'}});h.render();await h.flush();
  h.find(node=>node.type==='select'&&node.props.value===13.5).props.onChange({target:{value:'13.25'}});h.render();assert.equal(h.pay().props.disabled,true);
  h.find(node=>node.type==='select'&&node.props.value===13.25).props.onChange({target:{value:'13.5'}});h.render();assert.equal(h.pay().props.disabled,true,'Corrected window still requires a fresh check');await h.flush();h.find(node=>node.type==='button'&&node.props.children==='Choose spot').props.onClick();h.choose(1);h.pay().props.onClick();let payment=h.find(node=>node.type===h.values.PaymentModal);assert.equal(payment.props.startHour,12.5);assert.equal(payment.props.endHour,13.5);assert.equal(payment.props.hours,1);
  payment.props.onClose();h.render();h.find(node=>node.type==='select'&&node.props.value===13.5).props.onChange({target:{value:'13.75'}});h.render();await h.flush();assert.equal(h.pay().props.disabled,false);h.pay().props.onClick();payment=h.find(node=>node.type===h.values.PaymentModal);assert.equal(payment.props.chosenSpot,1);assert.equal(payment.props.endHour,13.75);assert.equal(payment.props.hours,1.25);assert.equal(h.requests.at(-1).url.includes('hours=1.25'),true);assert.equal(h.find(node=>node.type==='select'&&node.props.value===13.75).props['aria-invalid'],false);
 }finally{h.stop();}
});
test('BUG-005463 sub-hour schedules fail locally while a valid overnight window retains elapsed duration',async()=>{
 const h=detailHarness({fetcher:async()=>({ok:true,json:async()=>open(4)})});
 try{
  await h.flush();switchMode(h,'advance');h.render();await h.flush();
  for(const end of [9.25,9.5,9.75]){h.find(node=>node.type==='select'&&node.props['aria-label']==='Parking end time').props.onChange({target:{value:String(end)}});h.render();assert.equal(h.pay().props.disabled,true);assert.match(renderToStaticMarkup(h.render()),/minimum booking length is 1 hour/);}
  h.find(node=>node.type==='select'&&node.props.value===9).props.onChange({target:{value:'23.5'}});h.render();await h.flush();h.find(node=>node.type==='button'&&node.props.children==='Choose spot').props.onClick();h.choose(0);h.pay().props.onClick();const payment=h.find(node=>node.type===h.values.PaymentModal);assert.equal(payment.props.startHour,23.5);assert.equal(payment.props.endHour,24.5);assert.equal(payment.props.hours,1);
 }finally{h.stop();}
});

test('BUG-005464 the same bay survives both booking modes and payment waits for each new window',async()=>{
 const pending=[],h=detailHarness({fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
 try{
  for(const request of pending)request.resolve({ok:true,json:async()=>open(4)});await h.flush();h.choose(1);h.render();assert.equal(h.pay().props.disabled,false);
  switchMode(h,'advance');h.render();assertBay(h,'B');assert.equal(h.pay().props.disabled,true);h.pay().props.onClick();assert.equal(hasPayment(h),false);
  assert.ok(pending.at(-1).url.includes('bookingDate='));pending.at(-1).resolve({ok:true,json:async()=>open(4)});await h.flush();assert.equal(h.pay().props.disabled,false);h.pay().props.onClick();
  let payment=h.find(node=>node.type===h.values.PaymentModal);assert.equal(payment.props.chosenSpot,1);assert.equal(payment.props.selectedVehicleId,'primary');assert.equal(payment.props.startHour,9);assert.equal(payment.props.endHour,11);assert.equal(payment.props.hours,2);assert.ok(payment.props.date);
  payment.props.onClose();h.render();switchMode(h,'now');h.render();assertBay(h,'B');assert.equal(h.pay().props.disabled,true);pending.at(-1).resolve({ok:true,json:async()=>open(4)});await h.flush();assert.equal(h.pay().props.disabled,false);h.pay().props.onClick();
  payment=h.find(node=>node.type===h.values.PaymentModal);assert.equal(payment.props.chosenSpot,1);assert.equal(payment.props.hours,1);assert.equal(payment.props.date,undefined);
 }finally{h.stop();}
});
test('BUG-005464 another free bay cannot approve a retained held, booked, closed or unverified bay',async()=>{
 for(const kind of ['held','booked','closed','unverified']){
  const blocked={...open(4),spotStatus:{A:true,B:false,C:true,D:true},spotState:{B:kind}};
  if(kind==='closed')Object.assign(blocked,{available:false,hostScheduleOpen:false});if(kind==='unverified')delete blocked.spotStatus.B;
  const h=detailHarness({fetcher:async url=>({ok:true,json:async()=>url.includes('bookingDate=')?blocked:open(4)})});
  try{
   await h.flush();h.choose(1);h.render();switchMode(h,'advance');h.render();await h.flush();assertBay(h,'B');assert.equal(h.pay().props.disabled,true);h.pay().props.onClick();assert.equal(hasPayment(h),false);assert.match(renderToStaticMarkup(h.render()),/Spot B is unavailable for this time/);
   if(kind!=='closed'){h.choose(0);h.render();assert.equal(h.pay().props.disabled,false);h.pay().props.onClick();assert.equal(h.find(node=>node.type===h.values.PaymentModal).props.chosenSpot,0);}
  }finally{h.stop();}
 }
});
test('BUG-005464 failed availability checks preserve the requested bay without opening payment',async()=>{
 for(const failure of ['network','http']){
  const h=detailHarness({fetcher:async url=>{if(url.includes('bookingDate=')){if(failure==='network')throw Error('Synthetic offline');return {ok:false,status:503,json:async()=>({})};}return {ok:true,json:async()=>open(4)};}});
  try{await h.flush();h.choose(1);h.render();switchMode(h,'advance');h.render();await h.flush();assertBay(h,'B');assert.equal(h.pay().props.disabled,true);h.pay().props.onClick();assert.equal(hasPayment(h),false);assert.match(renderToStaticMarkup(h.render()),failure==='network'?/Synthetic offline/:/Unable to verify availability/);}finally{h.stop();}
 }
});
test('BUG-005464 rapid Now-Later-Now cannot reuse the earlier Now result or accept the late Later response',async()=>{
 const pending=[],h=detailHarness({fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
 try{
  for(const request of pending)request.resolve({ok:true,json:async()=>open(4)});await h.flush();h.choose(1);h.render();switchMode(h,'advance');h.render();const later=pending.at(-1);switchMode(h,'now');h.render();const current=pending.at(-1);
  assert.notEqual(current,later);assertBay(h,'B');assert.equal(h.pay().props.disabled,true,'Previously checked Now result is obsolete after revisiting that mode');later.resolve({ok:true,json:async()=>open(4)});await h.flush();assert.equal(h.pay().props.disabled,true);h.pay().props.onClick();assert.equal(hasPayment(h),false);
  current.resolve({ok:true,json:async()=>open(4)});await h.flush();assert.equal(h.pay().props.disabled,false);h.pay().props.onClick();assert.equal(h.find(node=>node.type===h.values.PaymentModal).props.chosenSpot,1);
 }finally{h.stop();}
});
test('BUG-005464 a different listing cannot inherit the prior bay or open payment dialog',async()=>{
 const h=detailHarness({fetcher:async()=>({ok:true,json:async()=>open(4)})});
 try{await h.flush();h.choose(1);h.pay().props.onClick();assert.equal(hasPayment(h),true);h.render({listing:{...h.props.listing,id:'db-8'}});assert.equal(hasPayment(h),false);assert.match(renderToStaticMarkup(h.render()),/Not selected yet/);await h.flush();assert.equal(h.pay().props.disabled,true);h.choose(2);h.pay().props.onClick();assert.equal(h.find(node=>node.type===h.values.PaymentModal).props.chosenSpot,2);}finally{h.stop();}
});
test('BUG-005464 valid duration, date and time edits retain the bay while revalidating the exact request',async()=>{
 const pending=[],h=detailHarness({fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
 const resolveCurrent=async()=>{pending.at(-1).resolve({ok:true,json:async()=>open(4)});await h.flush();assert.equal(h.pay().props.disabled,false);assertBay(h,'C');};
 try{
  for(const request of pending)request.resolve({ok:true,json:async()=>open(4)});await h.flush();h.choose(2);h.render();h.find(node=>node.type==='button'&&node.props.children==='2 hr').props.onClick();h.render();assertBay(h,'C');assert.equal(h.pay().props.disabled,true);assert.ok(pending.at(-1).url.includes('hours=2'));await resolveCurrent();
  switchMode(h,'advance');h.render();await resolveCurrent();h.find(node=>node.type==='button'&&node.props.children==='Change').props.onClick();const date=new Date(2030,10,4);h.find(node=>node.type===h.values.MiniCalendar).props.onSelect(date);h.render();assertBay(h,'C');assert.equal(h.pay().props.disabled,true);assert.ok(pending.at(-1).url.includes('bookingDate=2030-11-04'));await resolveCurrent();
  h.find(node=>node.type==='select'&&node.props.value===9).props.onChange({target:{value:'10'}});h.render();assertBay(h,'C');assert.equal(h.pay().props.disabled,true);assert.ok(pending.at(-1).url.includes('startHour=10'));await resolveCurrent();h.pay().props.onClick();const payment=h.find(node=>node.type===h.values.PaymentModal);assert.equal(payment.props.chosenSpot,2);assert.equal(localCalendarDate(payment.props.date),'2030-11-04');assert.equal(payment.props.startHour,10);assert.equal(payment.props.endHour,11);assert.equal(payment.props.hours,1);
 }finally{h.stop();}
});
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

test('Host without a vehicle can save in place and keep future spot, time and Host identity through checkout',async()=>{
 const h=detailHarness({count:8});
 const host={id:'host',role:'host',name:'Synthetic Host',guestVehicles:[]};
 h.render({user:host,onVehicleUpdated:vehicle=>h.render({user:{...h.props.user,...vehicle}})});
 await h.flush();h.later();h.render();await h.flush();
 h.find(node=>node.type==='button'&&node.props.children==='Choose spot').props.onClick();h.choose(7);
 assert.equal(h.pay().props.disabled,true);
 const editor=h.find(node=>node.type===h.values.BookingVehicleForm);
 assert.equal(editor.props.user.role,'host');
 const saved={vehicleMake:'Honda',vehicleModel:'Civic',vehicleColour:'Blue',licensePlate:'HOST 252'};
 // Same-account session refresh must not unmount the active save form.
 h.render({user:{...host,...saved}});assert.ok(h.find(node=>node.type===h.values.BookingVehicleForm));
 editor.props.onSaved(saved);h.render();assert.equal(h.pay().props.disabled,false);
 h.pay().props.onClick();const payment=h.find(node=>node.type===h.values.PaymentModal);
 assert.equal(payment.props.user.role,'host');assert.equal(payment.props.user.id,'host');
 assert.equal(payment.props.user.licensePlate,'HOST 252');assert.equal(payment.props.selectedVehicleId,'primary');
 assert.equal(payment.props.chosenSpot,7);assert.equal(payment.props.startHour,9);assert.equal(payment.props.endHour,11);assert.equal(payment.props.hours,2);
 assert.equal(localCalendarDate(payment.props.date),new URL(h.requests.at(-1).url,'https://fixture.invalid').searchParams.get('bookingDate'));h.stop();
});

test('Host can add a vehicle for Park Now without changing the selected bay or duration',async()=>{
 const h=detailHarness({count:4,fetcher:async()=>({ok:true,json:async()=>open(4)})});
 h.render({user:{id:'host',role:'host'},onVehicleUpdated:vehicle=>h.render({user:{...h.props.user,...vehicle}})});
 await h.flush();h.choose(2);const editor=h.find(node=>node.type===h.values.BookingVehicleForm);
 editor.props.onSaved({vehicleMake:'Toyota',vehicleModel:'RAV4',vehicleColour:'Red',licensePlate:'HOST NOW'});
 h.render();assert.equal(h.pay().props.disabled,false);h.pay().props.onClick();
 const payment=h.find(node=>node.type===h.values.PaymentModal);
 assert.equal(payment.props.chosenSpot,2);assert.equal(payment.props.date,undefined);assert.equal(payment.props.startHour,undefined);assert.equal(payment.props.user.role,'host');assert.equal(payment.props.selectedVehicleId,'primary');h.stop();
});

test('BUG-005466 rendered Book Now shows property-local dates and timezone on both labels',()=>{
 const savedNow=Date.now,savedZone=process.env.TZ;let h;
 Date.now=()=>Date.parse('2026-10-31T03:30:00Z');process.env.TZ='Europe/Athens';
 try{
  h=detailHarness({fetcher:async()=>({ok:true,json:async()=>open(4)})});
  let html=renderToStaticMarkup(h.render());
  assert.match(html,/Oct 30, 2026, 11:30.*EDT \(America\/Toronto\)/);
  assert.match(html,/Ends around Oct 31, 2026, 12:30.*EDT \(America\/Toronto\)/);
  h.render({listing:{...h.props.listing,timeZone:'America/Vancouver'}});
  html=renderToStaticMarkup(h.render());
  assert.match(html,/Oct 30, 2026, 8:30.*PDT \(America\/Vancouver\)/);
 }finally{h?.stop();Date.now=savedNow;if(savedZone===undefined)delete process.env.TZ;else process.env.TZ=savedZone;}
});

test('BUG-005467 rendered panel and picker explain closed Host hours without claiming occupancy',async()=>{
 const closed={...open(4),available:false,hostScheduleOpen:false,reason:'host_schedule',spacesFree:0,spotStatus:{A:false,B:false,C:false,D:false}};
 const h=detailHarness({fetcher:async()=>({ok:true,json:async()=>closed})});
 try{
  await h.flush();
  const tree=h.render(),html=renderToStaticMarkup(tree);
  assert.match(html,/Outside the Host&#x27;s available hours/);
  const pickerMessage=walk(tree).find(node=>node.type==='p'&&typeof node.props.children==='string'&&node.props.children.includes('available hours'));
  assert.ok(pickerMessage,'Spot picker also explains the schedule');
  assert.doesNotMatch(pickerMessage.props.children,/All spots are taken/);
  assert.equal(h.pay().props.disabled,true);
  h.choose(0);h.render();assert.equal(h.pay().props.disabled,true);
 }finally{h.stop();}
});

test('BUG-005448/005483/005484 invalid custom input stays visible, hides a quote, and cannot open spot selection or payment',async()=>{
 const h=detailHarness({fetcher:async()=>({ok:true,json:async()=>open(4)})});
 try{
  await h.flush();h.find(n=>n.type==='button'&&n.props.children==='Custom').props.onClick();h.render();await h.flush();
  for(const value of ['0','0.5','-3','abc','','800','1.1']){
   const before=h.requests.length;
   h.find(n=>n.type==='input'&&n.props.id==='booking-custom-hours').props.onChange({target:{value}});h.render();await h.flush();
   const input=h.find(n=>n.type==='input'&&n.props.id==='booking-custom-hours');assert.equal(input.props.value,value);assert.equal(input.props['aria-invalid'],true);assert.match(input.props['aria-describedby'],/booking-duration-error/);
   assert.equal(h.requests.length,before,'Invalid duration never queries availability');
   assert.equal(h.pay().props.disabled,true);h.pay().props.onClick();
   const choose=h.find(n=>n.type==='button'&&n.props.children==='Choose spot');assert.equal(choose.props.disabled,true);choose.props.onClick();
   const tree=h.render(),html=renderToStaticMarkup(tree),quote=walk(tree).find(n=>n.props?.className==='ps-booking-reserve-row');
   assert.match(html,/role="alert"/);assert.doesNotMatch(renderToStaticMarkup(quote),/\$|NaN/);
   assert.doesNotMatch(html,/Ends around|Missing or invalid listingId/);
   assert.equal(walk(tree).some(n=>n.type===h.values.PaymentModal||n.type===h.values.SpotPicker),false);
  }
  h.find(n=>n.type==='input'&&n.props.id==='booking-custom-hours').props.onChange({target:{value:'1.25'}});h.render();await h.flush();
  assert.ok(h.requests.some(r=>r.url.includes('hours=1.25')));
  h.find(n=>n.type==='button'&&n.props.children==='Choose spot').props.onClick();h.choose(1);h.render();assert.equal(h.pay().props.disabled,false);h.pay().props.onClick();
  assert.equal(h.find(n=>n.type===h.values.PaymentModal).props.hours,1.25);
 }finally{h.stop();}
});

test('an outstanding valid availability response cannot revive payment after duration becomes invalid',async()=>{
 const pending=[],h=detailHarness({fetcher:url=>new Promise(resolve=>pending.push({url,resolve}))});
 try{
  h.find(n=>n.type==='button'&&n.props.children==='Custom').props.onClick();h.render();
  h.find(n=>n.type==='input'&&n.props.id==='booking-custom-hours').props.onChange({target:{value:'800'}});h.render();
  for(const request of pending)request.resolve({ok:true,json:async()=>open(4)});
  await h.flush();assert.equal(h.pay().props.disabled,true);assert.match(renderToStaticMarkup(h.render()),/maximum booking length is 744/);
  h.find(n=>n.type==='button'&&n.props.children==='1 hr').props.onClick();h.render();
  assert.equal(h.pay().props.disabled,true,'Returning to a valid chip still waits for a fresh current-window response');
  pending.at(-1).resolve({ok:true,json:async()=>open(4)});await h.flush();
  h.find(n=>n.type==='button'&&n.props.children==='Choose spot').props.onClick();h.choose(0);h.render();assert.equal(h.pay().props.disabled,false);
 }finally{h.stop();}
});


for (const status of ['checking','not_ready','unknown','paused']) test(`BUG-005490 ${status} blocks spot selection and payment before a Driver chooses a bay`,async()=>{
 const h=detailHarness({bookability:status,fetcher:async()=>({ok:true,json:async()=>open(4)})});
 try{await h.flush();const trigger=h.find(n=>n.type==='button'&&n.props.children==='Choose spot');assert.equal(trigger.props.disabled,true);trigger.props.onClick();assert.equal(walk(h.render()).some(n=>n.type===h.values.SpotPicker),false);assert.equal(h.pay().props.disabled,true);h.pay().props.onClick();assert.equal(hasPayment(h),false);const html=renderToStaticMarkup(h.render());assert.match(html,new RegExp(bookingReadinessMessage(status).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.doesNotMatch(html,/free for that|spots? available now/);if(status!=='checking')assert.match(html,/Check again/);}finally{h.stop();}
});
test('BUG-005490 readiness loss closes payment and restoring readiness preserves a valid bay',async()=>{
 const h=detailHarness({fetcher:async()=>({ok:true,json:async()=>open(4)})});
 try{await h.flush();h.choose(1);h.pay().props.onClick();assert.equal(hasPayment(h),true);h.setBookability('not_ready');assert.equal(hasPayment(h),false);assert.equal(h.pay().props.disabled,true);assert.doesNotMatch(renderToStaticMarkup(h.render()),/Spot B is unavailable for this time|free for that/);h.setBookability('ready');assert.equal(h.pay().props.disabled,false);h.pay().props.onClick();assert.equal(h.find(n=>n.type===h.values.PaymentModal).props.chosenSpot,1);}finally{h.stop();}
});
