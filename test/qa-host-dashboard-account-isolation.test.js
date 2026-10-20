import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';

const source=await readFile(process.env.QA_HOST_DASHBOARD_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const begin=source.indexOf('function HostDashboard('),end=source.indexOf('  const myListings =',begin),prefix=source.slice(begin,end);
const names=[...prefix.matchAll(/const \[(\w+), \w+\] = useState/g)].map(m=>m[1]);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const session=id=>({data:{session:{access_token:id+'-token',user:{id}}}});
const payload=id=>({listings:[{id:7,title:id+' PRIVATE LISTING',address:id+' PRIVATE ADDRESS',price:12}],reviews:[{id:1,listing_id:7,text:id+' PRIVATE REVIEW',profiles:{name:id+' reviewer'},rating:5}],bookings:[{id:42,listing_id:7,listings:{title:id+' PRIVATE LISTING',address:id+' PRIVATE ADDRESS'},profiles:{name:id+' PRIVATE DRIVER'},vehicle_make:'Fixture',license_plate:id+' PRIVATE PLATE',hours:1,total:13.8,status:'confirmed',scheduled_starts_at:'2026-12-01T15:00:00Z',property_time_zone:'America/Toronto'}]});
const status=(enabled=false)=>({connected:true,chargesEnabled:enabled,payoutsEnabled:enabled});
function harness({auth=async()=>session('A'),refresh=async()=>session('A'),fetcher=async url=>Response.json(url.includes('connect-status')?status():payload('A')),photo=async()=>null}={}){
 const state={},writes=[],requests=[],photos=[],redirects=[],refs=[];let effects=[],cursor=0,refCursor=0,actions,refreshes=0;
 const values={useState:initial=>{const name=names[cursor++];if(!(name in state))state[name]=typeof initial==='function'?initial():initial;return [state[name],v=>{writes.push(name);state[name]=typeof v==='function'?v(state[name]):v;}];},useRef:initial=>refs[refCursor++]||(refs[refCursor-1]={current:initial}),useEffect:(fn,deps)=>effects.push({fn,deps}),
  supabase:{auth:{getSession:()=>auth(),refreshSession:()=>{refreshes++;return refresh();}}},fetch:(url,init)=>{requests.push({url,...init});return fetcher(url,init);},fetchPrivateCoverDataUrl:(...args)=>{photos.push(args);return photo(...args);},clientBookingWindow:row=>({start:new Date(row.scheduled_starts_at),end:new Date(Date.parse(row.scheduled_starts_at)+3600000)}),clientBookingDisplay:()=>({date:'Dec 1',startTime:'10 AM',endTime:'11 AM'}),bookingEventFromRow:()=>null,setInterval:()=>1,clearInterval:()=>{},window:{location:{assign:url=>redirects.push(url)}}};
 const Component=new Function(...Object.keys(values),prefix+'return {connectStripe};\n}; return HostDashboard;')(...Object.values(values));
 const cleanups=[];
 function render(id='A'){cursor=0;refCursor=0;effects=[];actions=Component({user:id?{id}:null});return effects;}
 function run(kind){const match=effects.find(e=>kind==='load'?e.fn.toString().includes('/api/account-bookings'):kind==='status'?/connect-status|refreshStripeStatus/.test(e.fn.toString()):e.fn.toString().includes('onboardingAttempt'));if(!match){if(kind==='life')return ()=>{};throw Error('Missing effect '+kind);}const stop=match.fn();const cleanup=typeof stop==='function'?stop:()=>{};cleanups.push(cleanup);return cleanup;}
 render();
 return {state,writes,requests,photos,redirects,render,run,get refreshes(){return refreshes;},connect:()=>actions.connectStripe(),stop(){for(const stop of cleanups.splice(0))stop();}};
}

test('late Host account response cannot overwrite another account listings, drivers, reviews or plates',async()=>{
 const old=deferred();let owner='A';const h=harness({auth:async()=>session(owner),fetcher:()=>owner==='A'?old.promise:Response.json(payload('B'))});const stop=h.run('load');await tick();stop();owner='B';h.render('B');h.run('load');await tick();old.resolve(Response.json(payload('A')));await tick();assert.equal(h.state.dbListings[0].title,'B PRIVATE LISTING');assert.equal(h.state.dbBookings[0].driver,'B PRIVATE DRIVER');assert.equal(h.state.dbBookings[0].vehicle.licensePlate,'B PRIVATE PLATE');assert.equal(h.state.hostReviews[0].text,'B PRIVATE REVIEW');assert.equal(h.requests[0].signal.aborted,true);h.stop();
});
test('new Host load clears previous cards, reviews and error while showing loading',async()=>{
 const h=harness();h.run('load');await tick();assert.equal(h.state.dbListings.length,1);h.state.hostError='A error';h.stop();h.render('B');h.run('load');assert.deepEqual(h.state.dbListings,[]);assert.deepEqual(h.state.dbBookings,[]);assert.deepEqual(h.state.hostReviews,[]);assert.equal(h.state.hostError,'');assert.equal(h.state.hostLoading,true);h.stop();await tick();
});
test('pending Host session lookup cannot start a request after cleanup or with another owner',async()=>{
 for(const disposed of [false,true]){const lookup=deferred(),h=harness({auth:()=>lookup.promise});h.run('load');if(disposed)h.stop();lookup.resolve(session(disposed?'A':'B'));await tick();assert.equal(h.requests.length,0);if(!disposed)assert.match(h.state.hostError,/account changed/i);h.stop();}
});
test('late photo cannot paint a newer account with the same listing or booking IDs',async()=>{
 const picture=deferred();let owner='A';const h=harness({auth:async()=>session(owner),fetcher:async()=>Response.json(payload(owner)),photo:()=>owner==='A'?picture.promise:Promise.resolve('B IMAGE')});const stop=h.run('load');await tick();stop();owner='B';h.render('B');h.run('load');await tick();picture.resolve('A PRIVATE IMAGE');await tick();assert.equal(h.state.dbListings[0].img,'B IMAGE');assert.equal(h.state.dbBookings[0].listingDetails.img,'B IMAGE');assert.equal(h.photos[0][3].aborted,true);h.stop();
});
test('a fast authorized photo survives initial booking card construction',async()=>{
 const h=harness({photo:async()=>'CURRENT IMAGE'});h.run('load');await tick();assert.equal(h.state.dbListings[0].img,'CURRENT IMAGE');assert.equal(h.state.dbBookings[0].listingDetails.img,'CURRENT IMAGE');assert.equal(h.requests[0].cache,'no-store');assert.equal(h.requests[0].headers.Authorization,'Bearer A-token');h.stop();
});
test('late JSON bodies and errors cannot write or begin photos after unmount',async()=>{
 for(const fail of [false,true]){const body=deferred(),h=harness({fetcher:async()=>({ok:true,json:()=>body.promise})});h.run('load');await tick();h.stop();const n=h.writes.length;if(fail)body.reject(Error('A PRIVATE ERROR'));else body.resolve(payload('A'));await tick();assert.equal(h.writes.length,n);assert.equal(h.photos.length,0);}
});
test('Host malformed, HTTP and auth failures show explicit errors without private partial cards',async()=>{
 for(const value of [null,{}, {...payload('A'),bookings:'bad'}, {...payload('A'),reviews:null}]){const h=harness({fetcher:async()=>Response.json(value)});h.run('load');await tick();assert.equal(h.state.hostLoading,false);assert.match(h.state.hostError,/load your dashboard/i);assert.deepEqual(h.state.dbListings,[]);assert.deepEqual(h.state.dbBookings,[]);h.stop();}
 const h=harness({auth:async()=>({error:Error('expired'),data:{session:null}})});h.run('load');await tick();assert.equal(h.requests.length,0);assert.match(h.state.hostError,/sign in/i);h.stop();
 const denied=harness({fetcher:async()=>Response.json({error:'Dashboard unavailable'},{status:503})});denied.run('load');await tick();assert.equal(denied.state.hostError,'Dashboard unavailable');assert.deepEqual(denied.state.dbListings,[]);denied.stop();
});
test('empty Host account is a completed empty load with no cover requests',async()=>{
 const h=harness({fetcher:async()=>Response.json({listings:[],bookings:[],reviews:[]})});h.run('load');await tick();assert.equal(h.state.hostLoading,false);assert.equal(h.state.hostError,'');assert.deepEqual(h.state.dbBookings,[]);assert.equal(h.photos.length,0);h.stop();
});
test('late Stripe payout status cannot overwrite the next Host status',async()=>{
 const old=deferred();let owner='A';const h=harness({auth:async()=>session(owner),fetcher:()=>owner==='A'?old.promise:Response.json(status(false))});const stop=h.run('status');await tick();stop();owner='B';h.render('B');h.run('status');await tick();old.resolve(Response.json(status(true)));await tick();assert.equal(h.state.stripeStatus.payoutsEnabled,false);assert.equal(h.requests[0].signal.aborted,true);assert.equal(h.requests[1].cache,'no-store');h.stop();
});
test('Stripe status rejects another session, null payload and invalid boolean fields',async()=>{
 const mismatch=harness({auth:async()=>session('B')});mismatch.run('status');await tick();assert.equal(mismatch.requests.length,0);assert.equal(mismatch.state.stripeStatus.unavailable,true);mismatch.stop();
 for(const value of [null,{}, {...status(),payoutsEnabled:'true'}]){const h=harness({fetcher:async()=>Response.json(value)});h.run('status');await tick();assert.equal(h.state.stripeStatus.unavailable,true);assert.equal(h.state.stripeStatus.payoutsEnabled,false);assert.ok(h.state.connectError);h.stop();}
});
test('disposed Stripe lookup/body failures cannot write errors into another dashboard',async()=>{
 for(const phase of ['lookup','body']){const pending=deferred(),h=harness({auth:phase==='lookup'?()=>pending.promise:async()=>session('A'),fetcher:async()=>({ok:true,json:()=>pending.promise})});h.run('status');await tick();h.stop();const n=h.writes.length;pending.reject(Error('OLD STRIPE ERROR'));await tick();assert.equal(h.writes.length,n);}
});
test('payout onboarding checks initial and refreshed account ownership before POST',async()=>{
 for(const refreshed of [false,true]){const h=harness({auth:async()=>refreshed?{data:{session:null}}:session('B'),refresh:async()=>session('B')});h.run('life');await h.connect();assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);assert.equal(h.state.connecting,false);assert.match(h.state.connectError,/sign in/i);h.stop();}
});
test('pending payout onboarding lookup or refresh cannot POST after leaving the dashboard',async()=>{
 for(const phase of ['lookup','refresh']){const pending=deferred(),h=harness({auth:phase==='lookup'?()=>pending.promise:async()=>({data:{session:null}}),refresh:()=>pending.promise});h.run('life');const work=h.connect();await tick();h.stop();const n=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);assert.equal(h.writes.length,n);}
});
test('repeated Connect clicks start one pending POST, bound to the original account',async()=>{
 const reply=deferred(),h=harness({fetcher:()=>reply.promise});h.run('life');const one=h.connect(),two=h.connect();await tick();assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,'POST');assert.equal(h.requests[0].headers.Authorization,'Bearer A-token');assert.deepEqual(JSON.parse(h.requests[0].body),{});reply.resolve(Response.json({url:'https://connect.stripe.com/synthetic'}));await Promise.all([one,two]);assert.deepEqual(h.redirects,['https://connect.stripe.com/synthetic']);assert.equal(h.state.connecting,true);h.stop();
});
test('a completed onboarding POST cannot redirect or change UI after dashboard disposal',async()=>{
 const reply=deferred(),h=harness({fetcher:()=>reply.promise});h.run('life');const work=h.connect();await tick();h.stop();const n=h.writes.length;reply.resolve(Response.json({url:'https://connect.stripe.com/OLD'}));await work;assert.equal(h.requests.length,1);assert.equal(h.redirects.length,0);assert.equal(h.writes.length,n);
});
test('onboarding rechecks the session before redirect even before the React auth update',async()=>{
 let count=0;const h=harness({auth:async()=>session(++count===1?'A':'B'),fetcher:async()=>Response.json({url:'https://connect.stripe.com/OLD'})});h.run('life');await h.connect();assert.equal(h.requests.length,1);assert.equal(h.redirects.length,0);assert.match(h.state.connectError,/account changed/i);assert.equal(h.state.connecting,false);h.stop();
});
test('same-account refresh can onboard; failed requests unlock explicit retry without auto replay',async()=>{
 let calls=0;const h=harness({auth:async()=>({data:{session:null}}),refresh:async()=>session('A'),fetcher:async()=>{calls++;return Response.json({error:'Try later'},{status:503});}});h.run('life');await h.connect();assert.equal(calls,1);assert.equal(h.state.connecting,false);assert.equal(h.state.connectError,'Try later');await h.connect();assert.equal(calls,2);h.stop();
 let count=0;const valid=harness({auth:async()=>++count===1?{data:{session:null}}:session('A'),fetcher:async()=>Response.json({url:'https://connect.stripe.com/current'})});valid.run('life');await valid.connect();assert.equal(valid.refreshes,1);assert.deepEqual(valid.redirects,['https://connect.stripe.com/current']);valid.stop();
});
test('signed-out Host effects perform no authenticated request',async()=>{
 const h=harness({auth:()=>{throw Error('unexpected lookup');}});h.render(null);h.run('load');h.run('status');h.run('life');await h.connect();await tick();assert.equal(h.requests.length,0);assert.equal(h.state.hostLoading,false);h.stop();
});
test('actual Host Dashboard key remounts cards, dialogs and payout state for every account',async()=>{
 const a=source.indexOf('<HostDashboard '),tag=source.slice(a,source.indexOf('/>',a)+2),compiled=await transform('function Parent({user}){return '+tag+';}',{loader:'jsx'});const Parent=new Function('React','HostDashboard','changeTab',compiled.code+';return Parent;')(React,()=>null,()=>{});assert.notEqual(Parent({user:{id:'A'}}).key,Parent({user:{id:'B'}}).key);assert.equal(Parent({user:{id:'A'}}).key,Parent({user:{id:'A',name:'new'}}).key);
});

async function hostMarkup(overrides={}){
 const whole=source.slice(begin,source.indexOf('// ─── Messages Inbox',begin)),stateNames=[...whole.matchAll(/const \[(\w+), \w+\] = useState/g)].map(m=>m[1]);let index=0;
 const components=Object.fromEntries([...whole.matchAll(/<([A-Z]\w*)\b/g)].map(m=>[m[1],()=>null]));
 const values={React,...components,C:new Proxy({},{get:()=>'#000'}),useState:initial=>{const name=stateNames[index++];return [name in overrides?overrides[name]:typeof initial==='function'?initial():initial,()=>{}];},useRef:initial=>({current:initial}),useEffect:()=>{},useTransactions:()=>({data:{earned:[],payouts:[]},loading:false,error:''}),hostEarnedTotal:()=>0,getBookingDisplayStatus:()=>'',money:v=>'$'+v,hostTransactionPresentation:()=>({label:'Paid'}),hostEarningsContribution:()=>0};
 const compiled=await transform(whole,{loader:'jsx'}),View=new Function(...Object.keys(values),compiled.code+';return HostDashboard;')(...Object.values(values));
 return renderToStaticMarkup(React.createElement(View,{user:{id:'A',name:'Fixture Host'}}));
}
test('actual dashboard distinguishes loading/error from confirmed empty Host history',async()=>{
 const loading=await hostMarkup();assert.match(loading,/Loading your dashboard/);for(const text of ['No listings yet','No upcoming bookings','No reviews yet'])assert.equal(loading.includes(text),false);
 const error=await hostMarkup({hostLoading:false,hostError:'Unable to load fixture'});assert.match(error,/role="alert"/);assert.match(error,/Unavailable/);assert.match(error,/Try again/);for(const text of ['No listings yet','No upcoming bookings','No reviews yet'])assert.equal(error.includes(text),false);
 const empty=await hostMarkup({hostLoading:false});for(const text of ['No listings yet','No upcoming bookings','No reviews yet'])assert.ok(empty.includes(text));
});
test('unavailable payout status shows a retry instead of claiming Stripe is disconnected',async()=>{
 const html=await hostMarkup({stripeStatus:{loading:false,unavailable:true,payoutsEnabled:false,accountId:null},connectError:'Status unavailable'});assert.match(html,/Status unavailable/);assert.match(html,/Try again/);assert.equal(html.includes('Set up payouts to get paid'),false);assert.equal(html.includes('Connect with Stripe'),false);
});
test('retry aborts the old load and its photos while preserving a newer successful reload',async()=>{
 const late=deferred();let calls=0;const h=harness({fetcher:()=>++calls===1?late.promise:Promise.resolve(Response.json(payload('LATEST')))});const stop=h.run('load');await tick();stop();h.run('load');await tick();late.resolve(Response.json(payload('STALE')));await tick();assert.equal(h.state.dbListings[0].title,'LATEST PRIVATE LISTING');assert.equal(h.state.hostLoading,false);assert.equal(h.state.hostError,'');assert.equal(h.requests[0].signal.aborted,true);h.stop();
});
