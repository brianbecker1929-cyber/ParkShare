import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {transform} from 'esbuild';

const source = await readFile(process.env.QA_TRANSACTION_SOURCE_FILE || new URL('../src/App.jsx', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function useTransactions('), source.indexOf('// Maps the real statuses'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const session = id => ({data:{session:{user:{id},access_token:id+'-token'}}});
const rows = id => ({spent:[{id:id+'-spent',amount:12,address:id+' PRIVATE ADDRESS'}],earned:[{id:id+'-earned',net:10}],payouts:[{id:id+'-payout',amount:9}],payoutsUnavailable:false});
const empty = {spent:[],earned:[],payouts:[],payoutsUnavailable:false};

// Execute the actual hook with controllable effect commits and transports.
// render() intentionally precedes commit(): private data must already be hidden
// in that first render, including the unkeyed Host earnings hook consumer.
function harness({auth=async()=>session('A'),refresh=async()=>session('A'),fetcher=async()=>Response.json(rows('A'))}={}) {
  const slots=[], pending=[], requests=[], writes=[]; let cursor=0, user=null, refreshes=0;
  const changed=(a,b)=>!a||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
  const values={
    useState:initial=>{const n=cursor++;if(!slots[n])slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);slots[n].value=typeof v==='function'?v(slots[n].value):v;}];},
    useMemo:(fn,deps)=>{const n=cursor++;if(!slots[n]||changed(slots[n].deps,deps))slots[n]={value:fn(),deps};return slots[n].value;},
    useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},
    useEffect:(fn,deps)=>{const n=cursor++;if(!slots[n]||changed(slots[n].deps,deps)){const old=slots[n];slots[n]={deps,cleanup:old?.cleanup};pending.push(()=>{old?.cleanup?.();slots[n].cleanup=fn();});}},
    supabase:{auth:{getSession:()=>auth(),refreshSession:()=>{refreshes++;return refresh();}}},
    fetch:(url,init)=>{requests.push({url,...init});return fetcher(url,init);},
  };
  const hook=new Function(...Object.keys(values),code+';return useTransactions;')(...Object.values(values));
  return {requests,writes,get refreshes(){return refreshes;},render(id){if(arguments.length)user=id?{id,role:'host'}:null;cursor=0;return hook(user);},commit(){for(const run of pending.splice(0))run();},stop(){for(const slot of slots)slot?.cleanup?.();}};
}

test('transaction rows and payout flags are hidden during the first account-change render',async()=>{
 const h=harness();h.render('A');h.commit();await tick();assert.deepEqual(h.render().data,rows('A'));
 const b=h.render('B');assert.deepEqual(b.data,empty);assert.equal(b.loading,true);assert.equal(b.error,'');h.stop();
});
test('sign-out immediately hides financial rows and previous errors before effects',async()=>{
 const h=harness();h.render('A');h.commit();await tick();h.render();const out=h.render(null);assert.deepEqual(out.data,empty);assert.equal(out.loading,false);assert.equal(out.error,'');h.commit();h.stop();
 const failed=harness({auth:async()=>{throw Error('A PRIVATE ERROR');}});failed.render('A');failed.commit();await tick();assert.match(failed.render().error,/A PRIVATE ERROR/);assert.equal(failed.render('B').error,'');failed.stop();
});
test('a session belonging to B cannot be used by the A transaction screen or trigger refresh',async()=>{
 const h=harness({auth:async()=>session('B')});h.render('A');h.commit();await tick();assert.equal(h.requests.length,0);assert.equal(h.refreshes,0);assert.match(h.render().error,/account changed/i);h.stop();
});
test('refresh results must still belong to the original account',async()=>{
 for(const refreshed of [session('B'),{data:{session:null}},{data:{session:{access_token:'unowned'}}}]){
  const h=harness({auth:async()=>({data:{session:null}}),refresh:async()=>refreshed});h.render('A');h.commit();await tick();assert.equal(h.requests.length,0);assert.equal(h.refreshes,1);assert.match(h.render().error,/sign in again/i);h.stop();
 }
});
test('a missing session can refresh once into the same account and load normally',async()=>{
 const h=harness({auth:async()=>({data:{session:null}})});h.render('A');h.commit();await tick();assert.equal(h.refreshes,1);assert.deepEqual(h.render().data,rows('A'));assert.equal(h.requests[0].headers.Authorization,'Bearer A-token');assert.equal(h.requests[0].cache,'no-store');h.stop();assert.equal(h.requests[0].signal.aborted,true);
});
test('initial lookup and refresh failures show an error without exposing financial data',async()=>{
 for(const initial of [true,false]){
  const h=harness({auth:async()=>{if(initial)throw Error('lookup failed');return {data:{session:null}};},refresh:async()=>({error:Error('refresh failed')})});h.render('A');h.commit();await tick();assert.deepEqual(h.render().data,empty);assert.equal(h.render().loading,false);assert.match(h.render().error,initial?/lookup failed/:/refresh failed/);assert.equal(h.requests.length,0);h.stop();
 }
});
test('an account change while getSession is pending cannot start an old request or refresh',async()=>{
 for(const result of [session('A'),{data:{session:null}}]){
  const lookup=deferred(),h=harness({auth:()=>lookup.promise});h.render('A');h.commit();h.render('B');lookup.resolve(result);await tick();assert.equal(h.requests.length,0);assert.equal(h.refreshes,0);h.stop();
 }
});
test('a disposed refresh cannot start a request, even when it returns the original account',async()=>{
 const refreshed=deferred(),h=harness({auth:async()=>({data:{session:null}}),refresh:()=>refreshed.promise});h.render('A');h.commit();await tick();h.stop();const n=h.writes.length;refreshed.resolve(session('A'));await tick();assert.equal(h.requests.length,0);assert.equal(h.writes.length,n);
});
test('late success cannot replace the next account data even when transport ignores abort',async()=>{
 const old=deferred();let owner='A';const h=harness({auth:async()=>session(owner),fetcher:()=>owner==='A'?old.promise:Response.json(rows('B'))});h.render('A');h.commit();await tick();owner='B';h.render('B');h.commit();await tick();old.resolve(Response.json(rows('A')));await tick();assert.deepEqual(h.render().data,rows('B'));assert.equal(h.requests[0].signal.aborted,true);h.stop();
});
test('render-time account change invalidates a pending body before old effect cleanup',async()=>{
 const body=deferred(),h=harness({fetcher:async()=>({ok:true,json:()=>body.promise})});h.render('A');h.commit();await tick();h.render('B');const n=h.writes.length;body.resolve(rows('A'));await tick();assert.equal(h.writes.length,n);assert.deepEqual(h.render().data,empty);h.stop();
});
test('late error and body rejection cannot write after disposal',async()=>{
 for(const bodyFailure of [false,true]){
  const reply=deferred(),h=harness({fetcher:()=>bodyFailure?Promise.resolve({ok:true,json:()=>reply.promise}):reply.promise});h.render('A');h.commit();await tick();h.stop();const n=h.writes.length;reply.reject(Error('A PRIVATE FAILURE'));await tick();assert.equal(h.writes.length,n);
 }
});
test('A to B to A cannot revive the first A interval data or request',async()=>{
 const first=deferred();let calls=0,owner='A';const h=harness({auth:async()=>session(owner),fetcher:()=>++calls===1?first.promise:Response.json(rows(owner+'-new'))});h.render('A');h.commit();await tick();owner='B';h.render('B');h.commit();await tick();owner='A';const a=h.render('A');assert.deepEqual(a.data,empty);h.commit();await tick();first.resolve(Response.json(rows('A-old')));await tick();assert.deepEqual(h.render().data,rows('A-new'));h.stop();
});
test('profile object refresh for the same account does not restart the financial request',async()=>{
 const h=harness();h.render('A');h.commit();await tick();h.render('A');h.commit();await tick();assert.equal(h.requests.length,1);assert.deepEqual(h.render().data,rows('A'));h.stop();
});
test('malformed success bodies fail closed without crashing Host earnings consumers',async()=>{
 for(const payload of [null,{}, {...empty,spent:'bad'},{...empty,earned:{}},{...empty,payouts:null}]){
  const h=harness({fetcher:async()=>Response.json(payload)});h.render('A');h.commit();await tick();const result=h.render();assert.deepEqual(result.data,empty);assert.equal(result.loading,false);assert.match(result.error,/load transactions/i);h.stop();
 }
});
test('HTTP and invalid-JSON errors render as errors rather than a false empty history',async()=>{
 for(const reply of [Response.json({error:'Not allowed'},{status:403}),new Response('bad gateway',{status:502}),new Response('not json')]){
  const h=harness({fetcher:async()=>reply});h.render('A');h.commit();await tick();assert.deepEqual(h.render().data,empty);assert.equal(h.render().loading,false);assert.ok(h.render().error);h.stop();
 }
});
test('payout unavailability and signed refund values are preserved for the current account',async()=>{
 const data={...rows('A'),earned:[{id:1,net:-15,refundedAmount:115}],payouts:[],payoutsUnavailable:true},h=harness({fetcher:async()=>Response.json(data)});h.render('A');h.commit();await tick();assert.deepEqual(h.render().data,data);assert.equal(h.render().error,'');h.stop();
});
test('signed-out transaction hook performs no session lookup or request',async()=>{
 const h=harness({auth:()=>{throw Error('unexpected lookup');}});assert.equal(h.render(null).loading,false);h.commit();await tick();assert.deepEqual(h.render().data,empty);assert.equal(h.requests.length,0);assert.equal(h.refreshes,0);h.stop();
});
test('actual transaction React keys reset category selection for same-role account changes',async()=>{
 const tags=[...source.matchAll(/<TransactionsView\b[^>]*\/>/g)].map(m=>m[0]);assert.equal(tags.length,2);
 for(const tag of tags){const compiled=await transform('function Parent({user}){return '+tag+';}',{loader:'jsx'});const Parent=new Function('React','TransactionsView',compiled.code+';return Parent;')(React,()=>null);const a=Parent({user:{id:'A'}}),b=Parent({user:{id:'B'}});assert.notEqual(a.key,b.key);assert.equal(a.key,Parent({user:{id:'A',name:'updated'}}).key);}
 assert.match(source.slice(source.indexOf('function HostDashboard('),source.indexOf('function MessagesView(')),/useTransactions\(user\)/);
});

test('failed financial history can retry one authenticated read and recover its rows',async()=>{
 let calls=0;const h=harness({fetcher:async()=>++calls===1?Response.json({error:'Temporarily unavailable'},{status:503}):Response.json(rows('A'))});h.render('A');h.commit();await tick();const failed=h.render();assert.match(failed.error,/unavailable/);
 failed.retry();const loading=h.render();assert.equal(loading.loading,true);assert.equal(loading.error,'');assert.deepEqual(loading.data,empty);h.commit();await tick();const recovered=h.render();assert.deepEqual(recovered.data,rows('A'));assert.equal(recovered.error,'');assert.equal(h.requests.length,2);
 for(const request of h.requests){assert.equal(request.url,'/api/transactions');assert.equal(request.cache,'no-store');assert.equal(request.headers.Authorization,'Bearer A-token');assert.equal(request.method,undefined);}assert.equal(h.requests[0].signal.aborted,true);h.stop();
});
test('queued duplicate retry callbacks cannot start extra reads before or after the next render',async()=>{
 const pending=deferred();let calls=0;const h=harness({fetcher:async()=>++calls===1?Response.json({},{status:503}):pending.promise});h.render('A');h.commit();await tick();const retry=h.render().retry;retry();retry();h.render();h.commit();retry();await tick();h.render().retry();h.render();h.commit();assert.equal(h.requests.length,2);pending.resolve(Response.json(rows('A')));await tick();h.stop();
});
test('every failed retry remains explicitly retryable without automatic polling',async()=>{
 const h=harness({fetcher:async()=>Response.json({},{status:503})});h.render('A');h.commit();await tick();assert.equal(h.requests.length,1);
 for(let i=0;i<2;i++){h.render().retry();h.render();h.commit();await tick();assert.ok(h.render().error);assert.equal(h.requests.length,i+2);}await tick();assert.equal(h.requests.length,3);h.stop();
});
test('old-account and disposed error callbacks cannot retry private financial reads',async()=>{
 for(const change of ['account','unmount']){const h=harness({fetcher:async()=>Response.json({},{status:503})});h.render('A');h.commit();await tick();const retry=h.render().retry;if(change==='account')h.render('B');else h.stop();const writes=h.writes.length;retry();assert.equal(h.writes.length,writes);assert.equal(h.requests.length,1);h.stop();}
});
test('retry rechecks account ownership before any new transaction request',async()=>{
 let owner='A';const h=harness({auth:async()=>session(owner),fetcher:async()=>Response.json({},{status:503})});h.render('A');h.commit();await tick();owner='B';h.render().retry();h.render();h.commit();await tick();assert.equal(h.requests.length,1);assert.match(h.render().error,/account changed/i);assert.deepEqual(h.render().data,empty);h.stop();
});
test('pending retry is aborted on unmount and cannot publish a late financial response',async()=>{
 const pending=deferred();let calls=0;const h=harness({fetcher:async()=>++calls===1?Response.json({},{status:503}):pending.promise});h.render('A');h.commit();await tick();h.render().retry();h.render();h.commit();await tick();h.stop();const count=h.writes.length;pending.resolve(Response.json(rows('A')));await tick();assert.equal(h.writes.length,count);assert.equal(h.requests[1].signal.aborted,true);
});
