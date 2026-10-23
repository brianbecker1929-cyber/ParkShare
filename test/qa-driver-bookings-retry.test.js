import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {matchesBookingDateRange} from '../src/lib/bookingDateFilter.js';
import {getBookingDisplayStatus,cancellationDeadlineError} from '../src/lib/bookingTime.js';

// Run the real component, including its action and load effect. External
// services and visual children are replaced; no live bookings are changed.
const source=await readFile(process.env.QA_DRIVER_BOOKINGS_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const begin=source.indexOf('function MyBookingsView(');
const whole=source.slice(begin,source.indexOf('function ReviewModal(',begin));
const compiled=await transform(whole,{loader:'jsx'});
const names=[...whole.matchAll(/const \[(\w+), \w+\] = useState/g)].map(m=>m[1]);
const windowCode=source.slice(source.indexOf('function clientBookingWindow('),source.indexOf('async function requestBookingCancellation('));
const helpers=new Function(windowCode+';return {clientBookingWindow,clientBookingDisplay};')();
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const row=(status='confirmed')=>({id:42,listing_id:7,status,hours:1,total:17.25,paid_at:'2050-10-01T00:00Z',booking_date:'2050-10-20',start_hour:9,scheduled_starts_at:'2050-10-20T13:00Z',property_time_zone:'America/Toronto',listings:{title:'Fixture driveway',address:'PRIVATE ADDRESS'}});
const success=bookings=>Response.json({bookings});
const nodes=tree=>!React.isValidElement(tree)?[]:[tree,...React.Children.toArray(tree.props.children).flatMap(nodes)];
const text=node=>!React.isValidElement(node)?String(node??''):React.Children.toArray(node.props.children).map(text).join('');
function harness({fetcher=async()=>success([]),auth=async()=>({data:{session:{access_token:'A-token',user:{id:'A'}}}}),photo=async()=>null}={}){
  const state={},requests=[],photos=[],effects=[],refs=[],cleanups=new Map(),dependencies=new Map();let cursor=0,refCursor=0,tree;
  const components=Object.fromEntries([...whole.matchAll(/<([A-Z]\w*)\b/g)].map(m=>[m[1],props=>React.createElement('span',null,props.children)]));
  const values={React,...components,...helpers,matchesBookingDateRange,getBookingDisplayStatus,cancellationDeadlineError,
    C:new Proxy({},{get:()=>'#000'}),money:v=>'$'+Number(v).toFixed(2),bookingEventFromRow:()=>null,
    useState:initial=>{const key=names[cursor++];if(!(key in state))state[key]=typeof initial==='function'?initial():initial;return [state[key],v=>{state[key]=typeof v==='function'?v(state[key]):v;}];},
    useRef:initial=>refs[refCursor++]||(refs[refCursor-1]={current:initial}),useEffect:(fn,deps)=>effects.push({fn,deps}),
    useBookingCancellation:()=>({target:null,busy:false,error:'',notice:''}),
    supabase:{auth:{getSession:auth}},fetch:(url,init)=>{requests.push({url,...init});return fetcher(url,init);},
    fetchPrivateCoverDataUrl:(...args)=>{photos.push(args);return photo(...args);},setInterval:()=>1,clearInterval:()=>{},
  };
  const View=new Function(...Object.keys(values),compiled.code+';return MyBookingsView;')(...Object.values(values));
  function render(){cursor=0;refCursor=0;effects.length=0;tree=View({user:{id:'A'}});return tree;}
  function commit(){render();effects.forEach(({fn,deps},i)=>{const previous=dependencies.get(i);if(previous&&deps.every((v,j)=>Object.is(v,previous[j])))return;cleanups.get(i)?.();dependencies.set(i,deps);cleanups.set(i,fn());});render();}
  function button(label){return nodes(tree).find(n=>n.type==='button'&&text(n)===label);}
  return {state,requests,photos,render,commit,button,html:()=>renderToStaticMarkup(tree),click(label){const b=button(label);assert.ok(b,'Missing button: '+label);assert.ok(!b.props.disabled);b.props.onClick();commit();},stop(){for(const cleanup of cleanups.values())if(typeof cleanup==='function')cleanup();}};
}

test('Driver can retry an actual failed booking read without leaving My bookings',async()=>{
  let count=0;const h=harness({fetcher:async()=>++count===1?Response.json({},{status:503}):success([row()])});
  h.commit();await tick();h.render();assert.match(h.html(),/role="alert"/);assert.match(h.html(),/couldn&#x27;t load/);
  h.click('Retry bookings');assert.ok(h.button('Loading bookings…').props.disabled);assert.doesNotMatch(h.html(),/couldn&#x27;t load|don't have any bookings/);
  await tick();h.render();assert.match(h.html(),/Fixture driveway/);assert.ok(h.button('Refresh bookings'));assert.equal(h.requests.length,2);
  for(const request of h.requests){assert.equal(request.url,'/api/account-bookings?view=driver');assert.equal(request.headers.Authorization,'Bearer A-token');assert.equal(request.cache,'no-store');assert.equal(request.method,undefined);}
  h.stop();
});
test('Refresh picks up Host cancellation and retains the selected date range',async()=>{
  let count=0;const h=harness({fetcher:async()=>success([row(++count===1?'confirmed':'refunded')])});h.commit();await tick();
  h.state.fromDate='2050-10-20';h.state.toDate='2050-10-20';h.render();assert.match(h.html(),/Upcoming/);
  h.click('Refresh bookings');assert.doesNotMatch(h.html(),/PRIVATE ADDRESS/);await tick();h.render();
  assert.match(h.html(),/Cancelled/);assert.equal(h.state.fromDate,'2050-10-20');assert.equal(h.state.toDate,'2050-10-20');assert.equal(h.state.dbBookings[0].canCancel,false);h.stop();
});
test('refreshed empty history is a successful read, distinct from loading or failure',async()=>{
  const h=harness();h.commit();assert.ok(h.button('Loading bookings…').props.disabled);assert.match(h.html(),/role="status"/);assert.doesNotMatch(h.html(),/don't have any bookings/);
  await tick();h.render();assert.match(h.html(),/don&#x27;t have any bookings/);h.click('Refresh bookings');await tick();h.render();assert.ok(h.button('Refresh bookings'));assert.equal(h.requests.length,2);h.stop();
});
test('late private cover from a previous read cannot paint the refreshed booking',async()=>{
  const oldPhoto=later();let count=0;const h=harness({fetcher:async()=>success([row()]),photo:()=>++count===1?oldPhoto.promise:Promise.resolve('CURRENT IMAGE')});
  h.commit();await tick();h.render();h.click('Refresh bookings');assert.equal(h.requests[0].signal.aborted,true);await tick();h.render();oldPhoto.resolve('STALE IMAGE');await tick();
  assert.equal(h.state.dbBookings[0].listing.img,'CURRENT IMAGE');h.stop();
});
test('repeated failures remain retryable, and unmount retires a pending retry',async()=>{
  const pending=later();let count=0;const h=harness({fetcher:async()=>++count<3?Response.json({},{status:503}):pending.promise});h.commit();await tick();h.render();h.click('Retry bookings');await tick();h.render();assert.ok(h.button('Retry bookings'));
  h.click('Retry bookings');await tick();h.stop();const saved=structuredClone(h.state);pending.resolve(success([row()]));await tick();assert.deepEqual(h.state,saved);assert.equal(h.requests[2].signal.aborted,true);assert.equal(h.photos.length,0);
});
test('retry rechecks the account before reading private bookings',async()=>{
  let owner='A';const h=harness({auth:async()=>({data:{session:{access_token:owner+'-token',user:{id:owner}}}}),fetcher:async()=>Response.json({},{status:503})});h.commit();await tick();h.render();owner='B';h.click('Retry bookings');await tick();h.render();assert.equal(h.requests.length,1);assert.ok(h.button('Retry bookings'));assert.deepEqual(h.state.dbBookings,[]);h.stop();
});

test('actual booking load retains the property zone so the displayed date and filter agree',async()=>{
  const b={...row(),booking_date:'2050-10-20',start_hour:21,scheduled_starts_at:'2050-10-21T01:00Z'};
  const h=harness({fetcher:async()=>success([b])});h.commit();await tick();h.render();
  assert.match(h.state.dbBookings[0].date,/Oct 20, 2050/);
  h.state.fromDate='2050-10-20';h.state.toDate='2050-10-20';h.render();assert.match(h.html(),/Fixture driveway/);assert.match(h.html(),/Showing 1 of 1 bookings/);
  h.state.fromDate='2050-10-21';h.state.toDate='2050-10-21';h.render();assert.doesNotMatch(h.html(),/Fixture driveway/);assert.match(h.html(),/No bookings found for these dates/);h.stop();
});

test('immediate booking date stays aligned with the property display after refreshing',async()=>{
  const b={...row(),booking_date:null,start_hour:null,scheduled_starts_at:null,paid_at:'2050-10-21T01:00Z'};
  const h=harness({fetcher:async()=>success([b])});h.commit();await tick();h.state.fromDate='2050-10-20';h.state.toDate='2050-10-20';h.render();
  assert.match(h.html(),/Fixture driveway/);assert.match(h.state.dbBookings[0].date,/Oct 20, 2050/);
  h.click('Refresh bookings');await tick();h.render();assert.match(h.html(),/Showing 1 of 1 bookings/);assert.equal(h.state.fromDate,'2050-10-20');h.stop();
});

test('Driver cancellation action expires at the one-hour boundary without reloading bookings',async()=>{
  const b=row(),h=harness({fetcher:async()=>success([b])});h.commit();await tick();h.render();assert.match(h.html(),/Cancel booking/);assert.equal(h.state.dbBookings[0].canCancel,true);
  const deadline=Date.parse(b.scheduled_starts_at)-3600000;h.state.currentTime=deadline;h.render();assert.match(h.html(),/Cancel booking/);
  h.state.currentTime=deadline+1;h.render();assert.doesNotMatch(h.html(),/Cancel booking/);assert.match(h.html(),/Upcoming/);assert.equal(h.requests.length,1);assert.equal(h.state.dbBookings[0].canCancel,true);h.stop();
});
