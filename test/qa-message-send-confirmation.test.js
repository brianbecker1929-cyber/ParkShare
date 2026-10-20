import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';

const source=await readFile(process.env.QA_MESSAGE_CONFIRMATION_SOURCE||new URL('../src/lib/messageConversation.js',import.meta.url),'utf8');
const {createMessageConversation,messageConversationKey}=new Function(source.replaceAll('export ','')+';return {createMessageConversation,messageConversationKey};')();
const session=()=>({data:{session:{access_token:'synthetic-token',user:{id:'A'}}},error:null});
const message=(overrides={})=>({id:11,listing_id:7,booking_id:42,sender_id:'A',recipient_id:'B',text:'draft',created_at:'2026-10-20T19:00:00Z',...overrides});
const ack=(overrides={})=>Response.json({message:message(overrides)},{status:201});
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({fetcher=async(_,init)=>init.method==='POST'?ack():Response.json({messages:[]}),auth=async()=>session(),...context}={}){
 const requests=[],rows=[],errors=[],busy=[];
 const c=createMessageConversation({client:{auth:{getSession:auth}},userId:'A',listingId:7,bookingId:42,participantId:'B',...context,fetcher:async(url,init)=>{requests.push({url,...init});return fetcher(url,init);},onMessages:value=>rows.push(value),onError:value=>errors.push(value),onSending:value=>busy.push(value)});
 return {c,requests,rows,errors,busy};
}

test('matching saved-row acknowledgement confirms once and refreshes the same conversation',async()=>{
 for(const stringIds of [false,true]){const h=harness({fetcher:async(_,init)=>init.method==='POST'?ack(stringIds?{id:'11',listing_id:'7',booking_id:'42'}:{}):Response.json({messages:[message()]})});assert.deepEqual(await h.c.send('  draft  '),{sent:true});assert.equal(h.requests.filter(x=>x.method==='POST').length,1);assert.equal(h.requests.length,2);assert.deepEqual(JSON.parse(h.requests[0].body),{listingId:7,bookingId:42,participantId:'B',text:'draft'});assert.equal(h.requests[0].cache,'no-store');assert.equal(h.requests[0].headers.Authorization,'Bearer synthetic-token');assert.deepEqual(h.rows,[[message()]]);assert.equal(h.c.sending,false);h.c.dispose();}
});
test('empty, malformed and foreign successful replies cannot claim delivery or discard the draft',async()=>{
 const invalid=[undefined,null,{}, {id:11},{message:null},...[
 {id:0},{id:-1},{id:true},{id:' '},{id:'9007199254740992'}, {listing_id:8}, {listing_id:undefined}, {booking_id:43},{booking_id:null},{sender_id:'OTHER'},{recipient_id:'OTHER'},{recipient_id:'A'},{recipient_id:''},{recipient_id:null},{text:'different text'}
 ].map(value=>({message:message(value)}))];
 for(const value of invalid){const h=harness({fetcher:async()=>value===undefined?new Response(null,{status:204}):Response.json(value)});assert.deepEqual(await h.c.send(' draft '),{sent:false,retryText:'draft'});assert.match(h.errors.at(-1),/couldn't confirm whether.*Reopen the conversation/);assert.equal(h.requests.length,1);assert.equal(h.rows.length,0);assert.equal(h.c.sending,false);h.c.dispose();}
});
test('listing-only conversations accept a valid server-resolved recipient and require an explicit null booking',async()=>{
 for(const valid of [true,false]){const h=harness({bookingId:null,participantId:null,fetcher:async(_,init)=>init.method==='POST'?ack({booking_id:valid?null:undefined,recipient_id:'server-resolved-host'}):Response.json({messages:[]})});const result=await h.c.send('draft');assert.equal(result.sent,valid);if(!valid)assert.equal(result.retryText,'draft');h.c.dispose();}
});
test('unknown-recipient listing sends still reject blank recipients and self-addressed confirmations',async()=>{
 for(const recipient_id of ['',null,'   ','A']){const h=harness({bookingId:null,participantId:null,fetcher:async()=>ack({booking_id:null,recipient_id})});assert.equal((await h.c.send('draft')).sent,false);assert.equal(h.requests.length,1);h.c.dispose();}
});
test('invalid JSON and interrupted successful response bodies preserve the draft with uncertain-send guidance',async()=>{
 for(const response of [new Response('<html>gateway</html>',{status:200}),{ok:true,status:201,json:async()=>{throw Error('Synthetic interrupted response');}}]){const h=harness({fetcher:async()=>response});assert.deepEqual(await h.c.send('draft'),{sent:false,retryText:'draft'});assert.match(h.errors.at(-1),/couldn't confirm whether/);assert.equal(h.requests.length,1);h.c.dispose();}
});
test('transport failure and ambiguous server/timeout replies do not imply that the POST was unsent',async()=>{
 for(const code of [null,500,503,408]){const h=harness({fetcher:async()=>{if(code===null)throw Error('Synthetic dropped connection');return Response.json({error:'Synthetic failure'},{status:code});}});assert.deepEqual(await h.c.send('draft'),{sent:false,retryText:'draft'});assert.match(h.errors.at(-1),/Reopen the conversation to check before trying again/);assert.equal(h.requests.length,1);assert.equal(h.c.sending,false);h.c.dispose();}
});
test('explicit permission rejection retains its error and draft without automatically retrying',async()=>{
 const h=harness({fetcher:async()=>Response.json({error:'Not allowed'},{status:403})});assert.deepEqual(await h.c.send('draft'),{sent:false,retryText:'draft'});assert.equal(h.errors.at(-1),'Not allowed');assert.equal(h.requests.length,1);h.c.dispose();
});
test('an older initial read cannot hide an uncertain-send warning or overwrite message history',async()=>{
 const pending=later();let reads=0;const h=harness({fetcher:async(_,init)=>init.method==='POST'?Response.json({}):++reads===1?pending.promise:Response.json({messages:[]})});const old=h.c.load();await tick();await h.c.send('draft');const warning=h.errors.at(-1),count=h.rows.length;assert.equal(h.requests[0].signal.aborted,true);pending.resolve(Response.json({messages:[{text:'OBSOLETE'}]}));await old;assert.equal(h.errors.at(-1),warning);assert.match(warning,/couldn't confirm/);assert.equal(h.rows.length,count);h.c.dispose();
});
test('a read waiting for its session cannot start a stale GET after send has retired it',async()=>{
 const pending=later();let calls=0;const h=harness({auth:()=>++calls===1?pending.promise:Promise.resolve(session()),fetcher:async()=>Response.json({})});const old=h.c.load();await h.c.send('draft');pending.resolve(session());await old;assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,'POST');h.c.dispose();
});
test('send lock spans POST, acknowledgement body and follow-up refresh',async()=>{
 const body=later(),read=later(),h=harness({fetcher:async(_,init)=>init.method==='POST'?{ok:true,status:201,json:()=>body.promise}:read.promise});const first=h.c.send('draft');await tick();assert.equal((await h.c.send('second')).sent,false);body.resolve({message:message()});await tick();assert.equal((await h.c.send('third')).sent,false);assert.equal(h.c.sending,true);read.resolve(Response.json({messages:[message()]}));assert.deepEqual(await first,{sent:true});assert.equal(h.requests.filter(x=>x.method==='POST').length,1);assert.deepEqual(h.busy,[true,false]);h.c.dispose();
});
test('a confirmed send followed by a failed refresh stays sent and does not offer duplicate retry text',async()=>{
 const h=harness({fetcher:async(_,init)=>init.method==='POST'?ack():Response.json({error:'Refresh unavailable'},{status:503})});assert.deepEqual(await h.c.send('draft'),{sent:true});assert.equal(h.errors.at(-1),'Refresh unavailable');assert.equal(h.requests.filter(x=>x.method==='POST').length,1);assert.equal(h.c.sending,false);h.c.dispose();
});
test('Close during an acknowledgement body suppresses late success/error and follow-up reads',async()=>{
 for(const reject of [false,true]){const pending=later(),h=harness({fetcher:async()=>({ok:true,status:201,json:()=>pending.promise})});const work=h.c.send('draft');await tick();h.c.dispose();const callbacks=h.errors.length+h.rows.length+h.busy.length;if(reject)pending.reject(Error('Obsolete response'));else pending.resolve({message:message()});assert.deepEqual(await work,{sent:false});assert.equal(h.requests.length,1);assert.equal(h.errors.length+h.rows.length+h.busy.length,callbacks);assert.equal((await h.c.send('old queued draft')).sent,false);}
});
test('preflight account change never starts a POST and preserves account-change guidance',async()=>{
 const h=harness({auth:async()=>({data:{session:{access_token:'other',user:{id:'B'}}}})});assert.deepEqual(await h.c.send('draft'),{sent:false,retryText:'draft'});assert.equal(h.requests.length,0);assert.match(h.errors.at(-1),/account changed/i);h.c.dispose();
});
test('an uncertain send allows one later explicit retry but never replays itself',async()=>{
 let posts=0;const h=harness({fetcher:async(_,init)=>init.method==='POST'?(++posts===1?Response.json({}):ack()):Response.json({messages:[message()]})});assert.equal((await h.c.send('draft')).sent,false);await tick();assert.equal(posts,1);assert.equal((await h.c.send('draft')).sent,true);assert.equal(posts,2);h.c.dispose();
});

const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8'),start=app.indexOf('function MessagingPanel(');
const compiled=(await transform(app.slice(start,app.indexOf('// ─── Payment Flow',start)),{loader:'jsx'})).code;
function panelHarness(fetcher){
 const state=[],refs=[],effects=[];let cursor=0,refCursor=0,closed=0;
 const values={React,C:{},INITIAL_THREADS:{},messageConversationKey,createMessageConversation:options=>createMessageConversation({...options,fetcher}),supabase:{auth:{getSession:async()=>session()}},useState:initial=>{const n=cursor++;if(!(n in state))state[n]=initial;return [state[n],value=>{state[n]=typeof value==='function'?value(state[n]):value;}];},useRef:initial=>refs[refCursor++]||(refs[refCursor-1]={current:initial}),useEffect:fn=>effects.push(fn),setTimeout:()=>{throw Error('No demo reply allowed');},clearTimeout:()=>{}};
 const Panel=new Function(...Object.keys(values),compiled+';return MessagingPanel;')(...Object.values(values));
 const render=()=>{cursor=0;refCursor=0;return Panel({listing:{id:'db-7',bookingId:42,participantId:'B',host:'Synthetic recipient'},user:{id:'A'},onClose:()=>closed++});};
 const find=(node,type)=>{if(!node||typeof node!=='object')return null;if(node.type===type)return node;for(const child of React.Children.toArray(node.props?.children)){const hit=find(child,type);if(hit)return hit;}return null;};
 render();const cleanup=effects[0]();
 return {state,render,cleanup,input:()=>find(render(),'input'),send:()=>find(render(),'button')?.props, get closed(){return closed;}};
}
test('actual composer restores an unconfirmed draft and exposes the check-before-retry guidance',async()=>{
 const h=panelHarness(async(_,init)=>init.method==='POST'?Response.json({}):Response.json({messages:[]}));await tick();h.input().props.onChange({target:{value:' draft '}});h.input().props.onKeyDown({key:'Enter'});await tick();assert.equal(h.state[2],'draft');assert.match(h.state[3],/Reopen the conversation to check/);assert.equal(h.state[4],false);h.cleanup();
});
test('actual composer never overwrites a newer typed draft with an unconfirmed older message',async()=>{
 const pending=later(),h=panelHarness(async(_,init)=>init.method==='POST'?pending.promise:Response.json({messages:[]}));await tick();h.input().props.onChange({target:{value:'old draft'}});h.input().props.onKeyDown({key:'Enter'});await tick();h.input().props.onChange({target:{value:'new draft'}});pending.resolve(Response.json({}));await tick();assert.equal(h.state[2],'new draft');assert.match(h.state[3],/couldn't confirm/);h.cleanup();
});
test('actual composer keeps a confirmed draft cleared when only the follow-up refresh fails',async()=>{
 let reads=0;const h=panelHarness(async(_,init)=>init.method==='POST'?ack():++reads===1?Response.json({messages:[]}):Response.json({error:'Refresh unavailable'},{status:503}));await tick();h.input().props.onChange({target:{value:'draft'}});h.input().props.onKeyDown({key:'Enter'});await tick();assert.equal(h.state[2],'');assert.equal(h.state[3],'Refresh unavailable');h.cleanup();
});
