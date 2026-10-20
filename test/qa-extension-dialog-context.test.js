import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {transform} from 'esbuild';
import {validId} from '../src/lib/privateListingAccess.js';
const source=await readFile(process.env.QA_EXTENSION_DIALOG_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const session=id=>({data:{session:{user:{id},access_token:id+'-token'}}});
const url=()=>Response.json({url:'https://checkout.stripe.com/synthetic'});
const start=source.indexOf('function ExtendSessionModal('),end=source.indexOf('// Return URLs describe',start);
const compiled=await transform(source.slice(start,end),{loader:'jsx'});
function find(element,type){if(!element||typeof element!=='object')return null;if(element.type===type)return element;for(const child of React.Children.toArray(element.props?.children)){const hit=find(child,type);if(hit)return hit;}return null;}
function modal({auth=async()=>session('A'),refresh=async()=>session('A'),fetcher=async()=>url(),bookingId=42,owner='A'}={}){
 const state=[],refs=[],effects=[],requests=[],redirects=[],writes=[];let cursor=0,refCursor=0,current=true,refreshes=0,closed=0;const Modal=()=>null,Btn=()=>null;
 const values={React,Modal,Btn,C:new Proxy({},{get:()=>'#000'}),validId,
  useState:initial=>{const n=cursor++;if(!(n in state))state[n]=typeof initial==='function'?initial():initial;return [state[n],v=>{writes.push(n);state[n]=typeof v==='function'?v(state[n]):v;}];},useRef:initial=>refs[refCursor++]||(refs[refCursor-1]={current:initial}),useEffect:fn=>effects.push(fn),
  supabase:{auth:{getSession:()=>auth(),refreshSession:()=>{refreshes++;return refresh();}}},fetch:(path,init)=>{requests.push({path,...init});return fetcher(path,init);},window:{location:{assign:value=>redirects.push(value)}}};
 const Component=new Function(...Object.keys(values),compiled.code+';return ExtendSessionModal;')(...Object.values(values));
 const isContextCurrent=()=>current;
 const render=()=>{cursor=0;refCursor=0;return Component({bookingId,user:owner?{id:owner}:null,isContextCurrent,onClose:()=>{closed++;}});};
 render();const cleanups=effects.splice(0).map(fn=>fn());
 return {state,requests,redirects,writes,get refreshes(){return refreshes;},get closed(){return closed;},render,pay:()=>find(render(),Btn).props.onClick(),close:()=>find(render(),Modal).props.onClose(),invalidate:()=>{current=false;},stop:()=>{for(const fn of cleanups)fn?.();}};
}

test('closing the extension dialog during session lookup prevents a new POST and redirect',async()=>{
 const lookup=deferred(),h=modal({auth:()=>lookup.promise});const work=h.pay();h.close();const n=h.writes.length;lookup.resolve(session('A'));await work;assert.equal(h.closed,1);assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);assert.equal(h.writes.length,n);h.stop();
});
test('extension context invalidation before effect cleanup blocks pending lookup and refresh',async()=>{
 for(const phase of ['lookup','refresh']){const wait=deferred(),h=modal({auth:phase==='lookup'?()=>wait.promise:async()=>({data:{session:null}}),refresh:()=>wait.promise});const work=h.pay();await tick();h.invalidate();const n=h.writes.length;wait.resolve(session('A'));await work;assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);assert.equal(h.writes.length,n);h.stop();}
});
test('initial and refreshed extension sessions must belong to the original account',async()=>{
 for(const refreshed of [false,true]){const h=modal({auth:async()=>refreshed?{data:{session:null}}:session('B'),refresh:async()=>session('B')});await h.pay();assert.equal(h.requests.length,0);assert.equal(h.redirects.length,0);assert.match(h.state[2],/account changed|sign in/i);assert.equal(h.state[1],false);if(!refreshed)assert.equal(h.refreshes,0);h.stop();}
});
test('duplicate pending extension submits start one POST with the original booking and duration',async()=>{
 const lookup=deferred(),reply=deferred();let calls=0;const h=modal({auth:()=>++calls===1?lookup.promise:Promise.resolve(session('A')),fetcher:()=>reply.promise});h.state[0]=2;const one=h.pay(),two=h.pay();h.state[0]=4;lookup.resolve(session('A'));await tick();assert.equal(h.requests.length,1);assert.equal(h.requests[0].path,'/api/create-extend-session');assert.equal(h.requests[0].method,'POST');assert.equal(h.requests[0].cache,'no-store');assert.equal(h.requests[0].headers.Authorization,'Bearer A-token');assert.deepEqual(JSON.parse(h.requests[0].body),{bookingId:42,addedHours:2});reply.resolve(url());await Promise.all([one,two]);assert.deepEqual(h.redirects,['https://checkout.stripe.com/synthetic']);assert.equal(h.state[1],true);h.stop();
});
test('an extension POST already submitted may finish but cannot redirect after close',async()=>{
 const reply=deferred(),h=modal({fetcher:()=>reply.promise});const work=h.pay();await tick();h.close();const n=h.writes.length;reply.resolve(url());await work;assert.equal(h.requests.length,1);assert.equal(h.redirects.length,0);assert.equal(h.writes.length,n);h.stop();
});
test('late extension bodies and errors cannot redirect or change a disposed dialog',async()=>{
 for(const failure of [false,true]){const body=deferred(),h=modal({fetcher:async()=>({ok:true,json:()=>body.promise})});const work=h.pay();await tick();h.stop();const n=h.writes.length;if(failure)body.reject(Error('OLD ERROR'));else body.resolve({url:'https://checkout.stripe.com/OLD'});await work;assert.equal(h.redirects.length,0);assert.equal(h.writes.length,n);}
});
test('extension response cannot redirect with a changed session even before React auth delivery',async()=>{
 let calls=0;const h=modal({auth:async()=>session(++calls===1?'A':'B')});await h.pay();assert.equal(h.requests.length,1);assert.equal(h.redirects.length,0);assert.match(h.state[2],/account changed/i);assert.equal(h.state[1],false);h.stop();
});
test('closing during the final extension session recheck suppresses navigation and errors',async()=>{
 const final=deferred();let calls=0;const h=modal({auth:()=>++calls===1?Promise.resolve(session('A')):final.promise});const work=h.pay();await tick();h.close();const n=h.writes.length;final.resolve(session('A'));await work;assert.equal(h.redirects.length,0);assert.equal(h.writes.length,n);h.stop();
});
test('failed extension checkout unlocks explicit retry without automatic replay',async()=>{
 let calls=0;const h=modal({fetcher:async()=>++calls===1?Response.json({error:'Interval unavailable'},{status:409}):url()});await h.pay();assert.equal(calls,1);assert.equal(h.state[2],'Interval unavailable');assert.equal(h.state[1],false);await h.pay();assert.equal(calls,2);assert.deepEqual(h.redirects,['https://checkout.stripe.com/synthetic']);h.stop();
});
test('malformed and unauthorized extension responses fail visibly without redirect',async()=>{
 for(const response of [Response.json(null),Response.json({}),new Response('bad gateway',{status:502}),Response.json({error:'Expired'},{status:401})]){const h=modal({fetcher:async()=>response});await h.pay();assert.equal(h.redirects.length,0);assert.ok(h.state[2]);assert.equal(h.state[1],false);h.stop();}
});
test('a missing extension session can refresh once only into the same original account',async()=>{
 let count=0;const h=modal({auth:async()=>++count===1?{data:{session:null}}:session('A')});await h.pay();assert.equal(h.refreshes,1);assert.equal(h.requests.length,1);assert.equal(h.redirects.length,1);h.stop();
});
test('invalid booking IDs or signed-out modal attempts cannot create extension checkout',async()=>{
 for(const bookingId of [0,-1,'42oops','9007199254740992']){const h=modal({bookingId});await h.pay();assert.equal(h.requests.length,0);assert.match(h.state[2],/reopen the booking/i);h.stop();}const h=modal({owner:null});await h.pay();assert.equal(h.requests.length,0);h.stop();
});

function requestHarness(){
 const a=source.indexOf('function useExtensionRequest(');assert.ok(a>=0,'Root extension request must be account-scoped');const code=source.slice(a,source.indexOf('function ExtendSessionModal(',a));let state,ref,changed=false,last,result;
 const values={validId,useState:initial=>{if(!state)state=initial();return [state,v=>{const next=typeof v==='function'?v(state):v;if(next!==state){state=next;changed=true;}}];},useRef:initial=>ref||(ref={current:initial}),useCallback:fn=>fn};
 const hook=new Function(...Object.keys(values),code+';return useExtensionRequest;')(...Object.values(values));
 return {render(id=last){last=id;let count=0;do{changed=false;result=hook(id?{id}:null);assert.ok(++count<5,'Render adjustment must converge');}while(changed);return result;},get result(){return result;}};
}
test('anonymous email extension request survives its first sign-in and clears on later account changes',()=>{
 const h=requestHarness();h.render(null).select('42');assert.equal(h.render(null).bookingId,42);assert.equal(h.render('A').bookingId,42);assert.equal(h.render('B').bookingId,null);assert.equal(h.render('A').bookingId,null);
});
test('sign-out clears an account-owned extension request before another sign-in',()=>{
 const h=requestHarness();h.render('A').select(42);assert.equal(h.render('A').bookingId,42);assert.equal(h.render(null).bookingId,null);assert.equal(h.render('B').bookingId,null);
});
test('old account and booking callbacks cannot reopen or close a new extension request',()=>{
 const h=requestHarness(),old=h.render('A');old.select(42);const first=h.render('A');assert.equal(first.isCurrent(),true);first.select(43);const second=h.render('A');assert.equal(first.isCurrent(),false);first.select(null);assert.equal(h.render('A').bookingId,43);h.render('B');h.render('A');old.select(42);second.select(43);assert.equal(h.render('A').bookingId,null);
});
test('same-account profile refresh retains intent while invalid IDs and explicit cancellation clear it',()=>{
 const h=requestHarness();h.render('A').select(42);assert.equal(h.render('A').bookingId,42);assert.equal(h.render('A').isCurrent(),true);h.result.select(null);assert.equal(h.render('A').bookingId,null);for(const id of ['-1','x','01','9007199254740992']){h.result.select(id);assert.equal(h.render('A').bookingId,null);}
});
test('root modal key resets duration and errors when either account or booking changes',async()=>{
 const a=source.indexOf('<ExtendSessionModal '),tag=source.slice(a,source.indexOf('/>',a)+2),built=await transform('function Parent({user,extendBookingId}){return '+tag+';}',{loader:'jsx'});const Parent=new Function('React','ExtendSessionModal','isExtensionContextCurrent','setExtendBookingId',built.code+';return Parent;')(React,()=>null,()=>true,()=>{});const one=Parent({user:{id:'A'},extendBookingId:42});assert.notEqual(one.key,Parent({user:{id:'B'},extendBookingId:42}).key);assert.notEqual(one.key,Parent({user:{id:'A'},extendBookingId:43}).key);assert.equal(one.props.user.id,'A');assert.equal(typeof one.props.isContextCurrent,'function');
});
async function extensionSignInProps(onClose,onAuth){
 const a=source.indexOf('{extendBookingId && !showAuth && ('),b=source.indexOf('<SignInModal ',a),tag=source.slice(b,source.indexOf('/>',b)+2),built=await transform('function Parent(){return '+tag+';}',{loader:'jsx'});return new Function('React','SignInModal','setExtendBookingId','handleAuth',built.code+';return Parent;')(React,()=>null,onClose,onAuth)().props;
}
test('actual extension email sign-in submits without clearing the requested booking',async()=>{
 let selected=42,authenticated=null;const props=await extensionSignInProps(v=>{selected=v;},u=>{authenticated=u;});
 const a=source.indexOf('function SignInModal('),code=source.slice(a,source.indexOf('  const pickRole =',a));let index=0;
 const values={C:{},useRef:initial=>({current:initial}),useEffect:()=>{},useState:initial=>{const n=index++;return [n===0?'signin':n===1?{email:'synthetic@example.invalid',password:'synthetic-password'}:typeof initial==='function'?initial():initial,()=>{}];},emptyAuthForm:()=>({}),validateAuthForm:()=>({}),buildAppUser:(profile,user)=>({id:user.id,role:profile.role}),supabase:{auth:{signInWithPassword:async()=>({data:{user:{id:'A'},session:{access_token:'A-token',user:{id:'A'}}}}),getSession:async()=>({data:{session:{access_token:'A-token',user:{id:'A'}}}})},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{id:'A',role:'driver'}})})})})}};
 const SignIn=new Function(...Object.keys(values),code+'return {submit};};return SignInModal;')(...Object.values(values));await SignIn(props).submit();assert.equal(authenticated.id,'A');assert.equal(selected,42);assert.equal(props.initialScreen,'signin');assert.equal(props.closeOnAuth,false);
});
test('email extension sign-in can still be cancelled explicitly',async()=>{
 let selected=42;const props=await extensionSignInProps(v=>{selected=v;},()=>{});props.onClose();assert.equal(selected,null);
});
