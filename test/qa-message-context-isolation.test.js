import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {createMessageConversation,messageConversationKey} from '../src/lib/messageConversation.js';
const source=await readFile(process.env.QA_MESSAGE_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const session=owner=>({data:{session:{access_token:owner+'-token',user:{id:owner}}}});
const ok=messages=>Response.json({messages});
function conversation(owner,options={}){
 const requests=[],updates=[],errors=[],busy=[];
 const c=createMessageConversation({client:{auth:{getSession:options.session||(()=>Promise.resolve(session(owner)))}},userId:owner,listingId:7,bookingId:42,participantId:'party-'+owner,
  fetcher:async(url,init)=>{requests.push({url,...init});return options.fetcher?options.fetcher(url,init):ok([]);},onMessages:rows=>updates.push(rows),onError:error=>errors.push(error),onSending:value=>busy.push(value)});
 return {c,requests,updates,errors,busy};
}
test('disposed conversation ignores late message bodies and errors even if fetch ignores abort',async()=>{
 for(const failure of [false,true]){const reply=deferred(),a=conversation('A',{fetcher:()=>reply.promise});const load=a.c.load();await tick();a.c.dispose();if(failure)reply.reject(Error('A failure'));else reply.resolve(ok([{text:'A PRIVATE'}]));await load;assert.equal(a.updates.length,0);assert.equal(a.errors.length,0);assert.equal(a.requests[0].signal.aborted,true);}
});
test('newer refresh wins over an older response in the same conversation',async()=>{
 const first=deferred(),second=deferred();let n=0;const f=conversation('A',{fetcher:()=>++n===1?first.promise:second.promise});const one=f.c.load();await tick();const two=f.c.load();await tick();second.resolve(ok([{text:'latest'}]));await two;first.resolve(ok([{text:'old'}]));await one;assert.deepEqual(f.updates,[[{text:'latest'}]]);assert.equal(f.requests[0].signal.aborted,true);
});
test('reads and sends require the original session owner and use no user-editable role claims',async()=>{
 for(const action of ['load','send']){const f=conversation('A',{session:async()=>({...session('B'),user_metadata:{role:'host'}})});await (action==='load'?f.c.load():f.c.send('draft'));assert.equal(f.requests.length,0);assert.match(f.errors.at(-1),/account changed/i);}
});
test('a disposed pending session lookup cannot start a GET or a POST',async()=>{
 for(const action of ['load','send']){const auth=deferred(),f=conversation('A',{session:()=>auth.promise});const work=action==='load'?f.c.load():f.c.send('draft');f.c.dispose();const callbacks=f.errors.length+f.busy.length;auth.resolve(session('A'));await work;assert.equal(f.requests.length,0);assert.equal(f.errors.length+f.busy.length,callbacks);}
});
test('simultaneous sends start only one POST and preserve its exact recipient context',async()=>{
 const reply=deferred(),f=conversation('A',{fetcher:(url,init)=>init.method==='POST'?reply.promise:ok([])});const first=f.c.send('  one message  ');const duplicate=await f.c.send('second');assert.equal(duplicate.sent,false);await tick();assert.equal(f.requests.length,1);assert.deepEqual(JSON.parse(f.requests[0].body),{listingId:7,bookingId:42,participantId:'party-A',text:'one message'});assert.equal(f.requests[0].headers.Authorization,'Bearer A-token');assert.equal(f.requests[0].cache,'no-store');reply.resolve(Response.json({id:1}));assert.equal((await first).sent,true);assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.deepEqual(f.busy,[true,false]);
});
test('a send already submitted before closing may finish but cannot refresh or modify a later view',async()=>{
 const reply=deferred(),f=conversation('A',{fetcher:()=>reply.promise});const send=f.c.send('authorized original request');await tick();f.c.dispose();const callbacks=f.updates.length+f.errors.length+f.busy.length;reply.resolve(Response.json({id:1}));await send;assert.equal(f.requests.length,1);assert.equal(f.updates.length+f.errors.length+f.busy.length,callbacks);assert.equal(await f.c.send('old draft').then(x=>x.sent),false);
});
test('send success refreshes only the same booking/participant and supersedes initial reads',async()=>{
 const initial=deferred();let reads=0;const f=conversation('A',{fetcher:(url,init)=>init.method==='POST'?Response.json({id:1}):++reads===1?initial.promise:ok([{id:1,text:'sent'}])});const old=f.c.load();await tick();assert.equal((await f.c.send('sent')).sent,true);initial.resolve(ok([{text:'stale initial'}]));await old;assert.deepEqual(f.updates,[[{id:1,text:'sent'}]]);for(const r of f.requests.filter(r=>r.method!=='POST')){const p=new URL(r.url,'https://synthetic.invalid').searchParams;assert.equal(p.get('listingId'),'7');assert.equal(p.get('bookingId'),'42');assert.equal(p.get('participantId'),'party-A');assert.equal(r.cache,'no-store');}
});
test('failed active send returns its draft for explicit retry and never auto-replays',async()=>{
 const f=conversation('A',{fetcher:()=>Response.json({error:'Not allowed'},{status:403})});const result=await f.c.send('draft');assert.deepEqual(result,{sent:false,retryText:'draft'});assert.equal(f.requests.length,1);assert.equal(f.errors.at(-1),'Not allowed');assert.equal(f.c.sending,false);
});
test('malformed read payloads and expired sessions fail closed',async()=>{
 const f=conversation('A',{fetcher:()=>Response.json({messages:'invalid'})});await f.c.load();assert.equal(f.updates.length,0);assert.match(f.errors.at(-1),/load messages/i);
 const expired=conversation('A',{session:async()=>({data:{session:null}})});await expired.c.load();assert.equal(expired.requests.length,0);assert.match(expired.errors.at(-1),/account changed/i);
});
test('signed-out persisted listings cannot send or simulate a real conversation',async()=>{
 const f=conversation(null);await f.c.load();assert.equal((await f.c.send('hello')).sent,false);assert.equal(f.requests.length,0);assert.match(f.errors.at(-1),/sign in/i);
});
test('conversation keys distinguish account, booking and participant within the same listing',()=>{
 const listing={id:'db-7',bookingId:42,participantId:'driver-A'},key=messageConversationKey('host',listing);for(const other of [messageConversationKey('other',listing),messageConversationKey('host',{...listing,bookingId:43}),messageConversationKey('host',{...listing,participantId:'driver-B'})])assert.notEqual(other,key);assert.equal(messageConversationKey('host',{...listing,title:'Updated title'}),key);
});
function inboxHarness(){
 const a=source.indexOf('function MessagesView('),code=source.slice(source.indexOf('  useEffect(() => {',a),source.indexOf('  const conversations =',a));
 const state={rows:[],loading:false,error:''},requests=[],writes=[];
 const set=key=>value=>{state[key]=typeof value==='function'?value(state[key]):value;writes.push(key);};
 function load(owner,{auth,reply=deferred()}={}){let run;const values={user:{id:owner},useEffect:callback=>{run=callback;},supabase:{auth:{getSession:()=>auth?.promise||Promise.resolve(session(owner))}},fetch:async(url,init)=>{requests.push({owner,url,...init});return reply.promise;},setDbConvos:set('rows'),setError:set('error'),setLoading:set('loading')};new Function(...Object.keys(values),code)(...Object.values(values));const cleanup=run();return {stop:typeof cleanup==='function'?cleanup:()=>{},reply};}
 return {state,requests,writes,load};
}
const inbox=owner=>Response.json({conversations:[{listingId:7,bookingId:42,participantId:owner+'-party',title:owner+' PRIVATE ADDRESS',otherParty:owner+' private name',preview:owner+' PRIVATE TEXT'}]});
test('inbox late response cannot overwrite the new account private preview',async()=>{
 const h=inboxHarness(),a=h.load('A');await tick();a.stop();const b=h.load('B');await tick();b.reply.resolve(inbox('B'));await tick();a.reply.resolve(inbox('A'));await tick();assert.equal(h.state.rows[0].preview,'B PRIVATE TEXT');assert.equal(h.state.rows[0].title,'B PRIVATE ADDRESS');assert.equal(h.requests[0].signal.aborted,true);
});
test('inbox account transition clears prior private cards and errors before loading',async()=>{
 const h=inboxHarness(),a=h.load('A');await tick();a.reply.resolve(inbox('A'));await tick();a.stop();h.state.error='A error';h.load('B');assert.deepEqual(h.state.rows,[]);assert.equal(h.state.error,'');assert.equal(h.state.loading,true);
});
test('inbox late failures, session mismatches and unmounts cannot write or request a different account',async()=>{
 const h=inboxHarness(),a=h.load('A');await tick();a.stop();const count=h.writes.length;a.reply.reject(Error('old error'));await tick();assert.equal(h.writes.length,count);
 const auth=deferred(),other=inboxHarness();other.load('A',{auth});auth.resolve(session('B'));await tick();assert.equal(other.requests.length,0);assert.match(other.state.error,/sign in/i);
 const waiting=deferred(),unmounted=inboxHarness(),old=unmounted.load('A',{auth:waiting});old.stop();waiting.resolve(session('A'));await tick();assert.equal(unmounted.requests.length,0);
});
test('account scope prevents a previous open panel from reappearing after A to B to A',()=>{
 const a=source.indexOf('  const messageScope ='),b=source.indexOf('  const [showAuth',a),code=source.slice(a,b);let stored=null,lastId,memo;const ref={current:null};
 function render(id){let select;const values={user:id?{id}:null,messageThreadState:stored,setMessageThreadState:v=>{stored=typeof v==='function'?v(stored):v;},useRef:()=>ref,useEffect:fn=>fn(),useMemo:(fn,deps)=>{if(lastId!==deps[0]||!memo){memo=fn();lastId=deps[0];}return memo;},useCallback:fn=>fn};const result=new Function(...Object.keys(values),code+';return {setMessageThread,messageThread};')(...Object.values(values));return result;}
 const oldA=render('A');oldA.setMessageThread({id:'db-7',private:'A'});assert.equal(render('A').messageThread.private,'A');assert.equal(render('B').messageThread,null);oldA.setMessageThread({id:'db-7',private:'late A'});assert.equal(render('B').messageThread,null);assert.equal(render('A').messageThread,null);
});
test('actual React keys reset inbox, email context, conversation history and drafts by identity',async()=>{
 const tags=[['MessagesView','onOpenThread'],['EmailMessageListing','bookingId'],['MessagingPanel','listing']];
 for(const [name] of tags){const a=source.indexOf('<'+name+' '),tag=source.slice(a,source.indexOf('/>',a)+2);const compiled=await transform('function Parent({user,messageThread,messageBookingId=42}){return '+tag+';}',{loader:'jsx'});const values={React,[name]:()=>null,messageConversationKey,setMessageThread:()=>{},messageBookingId:42,closeEmailListing:()=>{},previewParkingRoute:()=>{},navigateToParking:()=>{},changeNavigationApp:()=>{}};const Parent=new Function(...Object.keys(values),compiled.code+';return Parent;')(...Object.values(values));const listing={id:'db-7',bookingId:42,participantId:'one'};const one=Parent({user:{id:'A'},messageThread:listing}),two=Parent({user:{id:'B'},messageThread:listing});assert.notEqual(one.key,two.key,name);if(name==='EmailMessageListing')assert.notEqual(one.key,Parent({user:{id:'A'},messageThread:listing,messageBookingId:43}).key);if(name==='MessagingPanel')assert.notEqual(one.key,Parent({user:{id:'A'},messageThread:{...listing,participantId:'two'}}).key);}
});
async function panelHarness({real=true,user={id:'A'},fetcher=async()=>ok([]),auth}={}){
 const a=source.indexOf('function MessagingPanel('),code=source.slice(a,source.indexOf('// ─── Payment Flow',a));const compiled=await transform(code,{loader:'jsx'});
 const state=[],refs=[],effects=[],timers=new Map(),cleared=[];let cursor=0,refCursor=0;
 const values={React,C:new Proxy({},{get:()=> '#000'}),INITIAL_THREADS:{},messageConversationKey,
  useState:initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return [state[index],v=>{state[index]=typeof v==='function'?v(state[index]):v;}];},
  useRef:initial=>refs[refCursor++]|| (refs[refCursor-1]={current:initial}),useEffect:fn=>effects.push(fn),
  supabase:{auth:{getSession:auth||(()=>Promise.resolve(session(user?.id)))}},
  createMessageConversation:options=>createMessageConversation({...options,fetcher}),
  setTimeout:callback=>{const id=timers.size+1;timers.set(id,callback);return id;},clearTimeout:id=>{cleared.push(id);timers.delete(id);}};
 const Panel=new Function(...Object.keys(values),compiled.code+';return MessagingPanel;')(...Object.values(values));
 const render=()=>{cursor=0;refCursor=0;return Panel({listing:{id:real?'db-7':'demo-7',bookingId:42,participantId:'party',host:'Other',title:'Synthetic'},user,onClose:()=>{}});};
 render();const cleanup=effects[0]();await tick();state[2]='draft';
 const find=(element,type)=>{if(!element||typeof element!=='object')return null;if(element.type===type)return element;for(const child of React.Children.toArray(element.props?.children)){const hit=find(child,type);if(hit)return hit;}return null;};
 return {state,timers,cleared,cleanup,render,input:()=>find(render(),'input')};
}
test('actual persisted-listing panel never creates fake replies while signed out',async()=>{
 let calls=0;const h=await panelHarness({user:null,fetcher:async()=>{calls++;throw Error('must not fetch');}});await h.input().props.onKeyDown({key:'Enter'});await tick();assert.equal(calls,0);assert.equal(h.timers.size,0);assert.equal(h.state[2],'draft');assert.match(h.state[3],/sign in/i);h.cleanup();
});
test('actual panel Enter handling blocks parallel sends and preserves a new draft after failure',async()=>{
 const response=deferred();let posts=0;const h=await panelHarness({fetcher:(url,init)=>{if(init.method==='POST'){posts++;return response.promise;}return ok([]);}});
 h.input().props.onKeyDown({key:'Enter'});await tick();h.state[2]='new draft';await h.input().props.onKeyDown({key:'Enter'});assert.equal(posts,1);assert.equal(h.state[2],'new draft');response.resolve(Response.json({error:'Not allowed'},{status:403}));await tick();assert.equal(h.state[2],'new draft');h.cleanup();
});
test('closing a demo panel clears its simulated reply timer',async()=>{const h=await panelHarness({real:false,user:null});await h.input().props.onKeyDown({key:'Enter'});assert.equal(h.timers.size,1);h.cleanup();assert.equal(h.timers.size,0);assert.equal(h.cleared.length,1);});
test('email conversation context rejects a switched session and aborts stale read work',async()=>{
 const a=source.indexOf('function EmailMessageListing('),code=source.slice(source.indexOf('  useEffect(() => {',a),source.indexOf('  if (error)',a));
 for(const mismatch of [true,false]){
  const auth=deferred(),reply=deferred(),requests=[],opened=[],contexts=[];let run;
  const values={user:{id:'A'},bookingId:42,onMessage:v=>opened.push(v),setContext:v=>contexts.push(v),setError:()=>{},bookingMessageThread:v=>v,
   useEffect:fn=>{run=fn;},supabase:{auth:{getSession:()=>auth.promise}},fetch:async(url,init)=>{requests.push({url,...init});return reply.promise;}};
  new Function(...Object.keys(values),code)(...Object.values(values));const stop=run();auth.resolve(session(mismatch?'B':'A'));await tick();
  if(mismatch)assert.equal(requests.length,0);else{stop();reply.resolve(Response.json({private:'A'}));await tick();assert.equal(requests[0].signal.aborted,true);assert.equal(requests[0].cache,'no-store');assert.equal(opened.length,0);assert.deepEqual(contexts,[null]);}
 }
});
