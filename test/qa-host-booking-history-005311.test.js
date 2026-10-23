import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {getBookingDisplayStatus} from '../src/lib/bookingTime.js';

// Execute the actual Host dashboard, including its load, cancellation callback
// and view controls. Only external services/visual children are substituted.
const source=await readFile(process.env.QA_HOST_HISTORY_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const begin=source.indexOf('function HostDashboard(');
const whole=source.slice(begin,source.indexOf('// ─── Messages Inbox',begin));
const compiled=await transform(whole,{loader:'jsx'});
const names=[...whole.matchAll(/const \[(\w+), \w+\] = useState/g)].map(m=>m[1]);
const timeSource=source.slice(source.indexOf('function clientBookingWindow('),source.indexOf('async function requestBookingCancellation('));
const {clientBookingWindow,clientBookingDisplay}=new Function(timeSource+';return {clientBookingWindow,clientBookingDisplay};')();
const now=Date.parse('2026-10-21T16:00Z');
const booking=(id,status='Upcoming',extra={})=>({id:'db-'+id,rawId:id,driver:'Driver '+id,listing:'Driveway '+id,
  status,bookingStart:'2026-10-22T16:00Z',bookingEnd:'2026-10-22T17:00Z',total:17.25,canCancel:status==='Upcoming',
  date:'Oct 22, 2026',startTime:'12:00 p.m.',endTime:'1:00 p.m.',duration:'1 hr',spotLabel:'C',
  vehicle:{licensePlate:'TEST123'},listingDetails:{title:'Driveway '+id},...extra});
const nodes=tree=>!React.isValidElement(tree)?[]:[tree,...React.Children.toArray(tree.props.children).flatMap(nodes)];
const text=node=>!React.isValidElement(node)?String(node??''):React.Children.toArray(node.props.children).map(text).join('');
function harness(overrides={}){
  const state={dbBookings:[],hostLoading:false,currentTime:now,...overrides},effects=[],requests=[],tabs=[],scrolls=[];
  let cursor=0,cancelled,tree,rows=[];
  const visual=name=>props=>React.createElement('span',null,name==='BookingParkingDetails'?props.spotLabel:name==='BookingSchedule'?props.startTime+'–'+props.endTime:name==='BookingVehicleVisual'?props.vehicle.licensePlate:'');
  const components=Object.fromEntries([...whole.matchAll(/<([A-Z]\w*)\b/g)].map(m=>[m[1],visual(m[1])]));
  const values={React,...components,C:new Proxy({},{get:()=>'#000'}),
    useState:initial=>{const key=names[cursor++];if(!(key in state))state[key]=typeof initial==='function'?initial():initial;return [state[key],v=>{state[key]=typeof v==='function'?v(state[key]):v;}];},
    useRef:initial=>({current:initial}),useEffect:fn=>effects.push(fn),
    useHostListingEdit:()=>({listing:null}),useHostListingDeletion:()=>({deletingId:null,confirmDeleteId:null}),
    useBookingCancellation:(_user,_reason,onSaved)=>{cancelled=onSaved;return {target:null,busy:false,error:'',notice:''};},
    useTransactions:()=>({data:{earned:[],payouts:[]},loading:false,error:''}),hostEarnedTotal:()=>0,hostEarningsContribution:()=>0,hostTransactionPresentation:()=>({label:'Paid'}),
    money:v=>'$'+Number(v).toFixed(2),getBookingDisplayStatus,clientBookingWindow,clientBookingDisplay,bookingEventFromRow:()=>null,
    supabase:{auth:{getSession:async()=>({data:{session:{access_token:'fixture',user:{id:'HOST'}}}})}},
    fetch:async(url,init)=>{requests.push({url,...init});return Response.json({listings:[{id:7,title:'Fixture',price:15}],reviews:[],bookings:rows});},
    fetchPrivateCoverDataUrl:async()=>null,document:{getElementById:id=>({scrollIntoView:()=>scrolls.push(id)})},
  };
  const View=new Function(...Object.keys(values),compiled.code+';return HostDashboard;')(...Object.values(values));
  function render(){cursor=0;effects.length=0;tree=View({user:{id:'HOST',name:'Fixture Host'},setTab:tab=>tabs.push(tab)});return tree;}
  function click(label){const button=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(button,'Missing button: '+label);assert.ok(!button.props.disabled);button.props.onClick();render();}
  render();
  return {state,requests,tabs,scrolls,render,click,
    html:()=>renderToStaticMarkup(tree),panel:()=>renderToStaticMarkup(nodes(tree).find(n=>n.props.id==='host-dashboard-upcoming')),
    cancel:(id,result)=>{cancelled(id,result);render();},
    async load(serverRows){rows=serverRows;render();const load=effects.find(fn=>fn.toString().includes('/api/account-bookings'));assert.ok(load);const stop=load();await new Promise(resolve=>setImmediate(resolve));render();return stop;},
    clickUpcomingStat(){const button=nodes(tree).find(n=>n.props['aria-label']?.startsWith('Upcoming bookings:'));assert.ok(button);button.props.onClick();render();},
  };
}

test('cancelled future reservation stays findable in history with its details and no cancel action',()=>{
  const h=harness({dbBookings:[booking(311,'Cancelled')]});assert.match(h.panel(),/No upcoming bookings/);h.click('Booking history');
  const html=h.panel();for(const value of ['Reservation #PK-311','Cancelled','Driver 311','Driveway 311','TEST123','12:00 p.m.','1:00 p.m.','Booking total','$17.25','CAD'])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/Actions for|Cancel booking/);assert.match(html,/aria-pressed="true"[^>]*>Booking history/);
  h.click('View charges and refunds in Transactions →');assert.deepEqual(h.tabs,['Transactions']);
});
test('completed reservations appear in history while future, active and cancellation-pending stay upcoming',()=>{
  const h=harness({dbBookings:[booking(1),booking(2,'Active',{bookingStart:'2026-10-21T15:30Z',bookingEnd:'2026-10-21T16:30Z'}),booking(3,'Cancellation pending'),booking(4,'Completed'),booking(5,'Cancelled')]});
  assert.match(h.html(),/Upcoming bookings: 3\./);for(const id of [1,2,3])assert.ok(h.panel().includes('Driver '+id));
  h.click('Booking history');for(const id of [4,5])assert.ok(h.panel().includes('Driver '+id));for(const id of [1,2,3])assert.ok(!h.panel().includes('Driver '+id));
  assert.match(h.html(),/Upcoming bookings: 3\./);
});
test('time-based completion moves an active reservation into history without changing its stored row',()=>{
  const row=booking(1,'Active',{bookingStart:'2026-10-21T15:00Z',bookingEnd:'2026-10-21T17:00Z'}),h=harness({dbBookings:[row]});
  assert.ok(h.panel().includes('Driver 1'));h.state.currentTime=Date.parse(row.bookingEnd);h.render();assert.match(h.panel(),/No upcoming bookings/);h.click('Booking history');assert.match(h.panel(),/Completed/);assert.equal(row.status,'Active');
});
test('successful Host cancellation moves the same booking to history immediately; pending stays upcoming',()=>{
  const h=harness({dbBookings:[booking(311)]});h.cancel(311,{bookingStatus:'confirmed'});assert.match(h.panel(),/Cancellation pending/);h.click('Booking history');assert.match(h.panel(),/No completed or cancelled bookings/);
  h.cancel(311,{bookingStatus:'refunded'});assert.match(h.panel(),/Reservation #PK-311/);assert.match(h.panel(),/Cancelled/);assert.equal(h.state.dbBookings[0].canCancel,false);
  h.click('Upcoming');assert.match(h.panel(),/No upcoming bookings/);
});
test('refresh retains a Driver-cancelled booking from the authenticated payload and its property-local time',async()=>{
  const h=harness();h.click('Booking history');h.click('Refresh bookings');assert.equal(h.state.dashboardReload,1);
  const stop=await h.load([{id:311,listing_id:7,status:'refunded',hours:1,total:17.25,scheduled_starts_at:'2026-10-22T16:00Z',property_time_zone:'America/Toronto',booking_date:'2026-10-22',start_hour:12,spot_label:'C',license_plate:'TEST123',listings:{title:'Fixture'},profiles:{name:'Cancelled Driver'}}]);
  assert.match(h.panel(),/Cancelled Driver/);assert.match(h.panel(),/Cancelled/);assert.match(h.panel(),/12:00/);assert.equal(h.state.bookingView,'history');assert.equal(h.requests[0].headers.Authorization,'Bearer fixture');assert.equal(h.requests[0].cache,'no-store');assert.ok(h.requests[0].url.endsWith('?view=host'));stop();
});
test('history distinguishes loading, error and a successful empty response without showing stale cards',()=>{
  for(const state of [{hostLoading:true},{hostError:'History unavailable'}]){const h=harness({dbBookings:[booking(1,'Cancelled')],...state});h.click('Booking history');assert.doesNotMatch(h.panel(),/Driver 1|No completed or cancelled bookings/);}
  const h=harness();h.click('Booking history');assert.match(h.panel(),/No completed or cancelled bookings yet/);
});
test('view controls reset expansion and Upcoming stat always returns to its matching reservations',()=>{
  const h=harness({dbBookings:Array.from({length:5},(_,i)=>booking(i+1,'Cancelled')).concat(booking(8))});h.click('Booking history');assert.ok(!h.panel().includes('Driver 5'));h.click('View all 5');assert.ok(h.panel().includes('Driver 5'));h.click('Show less');assert.ok(!h.panel().includes('Driver 5'));h.click('View all 5');h.clickUpcomingStat();assert.equal(h.state.bookingView,'upcoming');assert.equal(h.state.showAllBookings,false);assert.deepEqual(h.scrolls,['host-dashboard-upcoming']);assert.ok(h.panel().includes('Driver 8'));h.click('Booking history');assert.ok(!h.panel().includes('Driver 5'));
});

test('actual Host load records its start cutoff and removes cancellation actions at the start without reloading',async()=>{
  const start=Date.parse('2050-10-22T16:00Z'),h=harness();const stop=await h.load([{id:42,listing_id:7,status:'confirmed',hours:1,total:17.25,scheduled_starts_at:new Date(start).toISOString(),property_time_zone:'America/Toronto',booking_date:'2050-10-22',start_hour:12,listings:{title:'Fixture'},profiles:{name:'Future Driver'}}]);
  assert.equal(h.state.dbBookings[0].cancellationDeadline,start-1);h.state.currentTime=start-1;h.state.bookingActionId='db-42';h.render();assert.match(h.panel(),/Cancel booking/);
  h.state.currentTime=start;h.render();assert.doesNotMatch(h.panel(),/Cancel booking|Actions for/);assert.match(h.panel(),/Active/);assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,undefined);stop();
});
