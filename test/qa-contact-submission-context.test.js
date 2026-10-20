import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
const source=await readFile(process.env.QA_CONTACT_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const compiled={};
for(const [kind,name,end] of [['support','ContactPage','// ─── Extend Session'],['event','EventSubmissionForm','// ─── Discover View']]){
 const start=source.indexOf('function '+name+'(');
 compiled[kind]=(await transform(source.slice(start,source.indexOf(end,start)),{loader:'jsx'})).code+';return '+name+';';
}
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const response=(kind,extra={})=>({ok:true,json:async()=>kind==='event'?{ok:true,reference:'EVT-000123'}:{ok:true},...extra});
function nodes(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);for(const child of React.Children.toArray(node.props?.children))nodes(child,predicate,out);return out;}
function harness(kind,send=async()=>response(kind)){
 const slots=[],effects=[],setups=[],writes=[],requests=[];let cursor=0,dirty=false,tree,closed=0;
 const values={React,C:{},Header:()=>null,HomeFooter:()=>null,ResponsiveMascot:()=>null,ContactField:()=>null,SUPPORT_EMAIL:'support@example.invalid',EVENT_CATEGORIES:[{value:'community',label:'Community'}],
 fetch:async(url,options)=>{requests.push({url,...options,body:JSON.parse(options.body)});return send(requests.length);},
 useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;dirty=true;}}];},
 useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},
 useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();setups[n]=fn;});}}};
 const Component=new Function(...Object.keys(values),compiled[kind])(...Object.values(values));
 function render(){let count=0;do{dirty=false;cursor=0;tree=Component({onClose:()=>closed++});for(const fn of effects.splice(0))fn();assert.ok(++count<8);}while(dirty);return tree;}
 const find=predicate=>{const n=nodes(render(),predicate)[0];assert.ok(n,'control exists');return n;};
 const change=(name,value)=>{if(kind==='support')find(n=>n.props?.name===name).props.onChange({target:{name,value}});else{const initial={organizerName:'',eventName:''};find(n=>n.type==='input'&&n.props?.maxLength===(name==='organizerName'?120:180)&&n.props.value===initial[name]).props.onChange({target:{value}});}};
 const submit=()=>find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
 const replay=()=>{for(const [n,fn] of setups.entries())if(fn){slots[n].cleanup?.();slots[n].cleanup=fn();}render();};
 render();
 if(kind==='support')for(const [name,value] of Object.entries({name:'Test Driver',email:'driver@example.invalid',helpType:'Booking',message:'Synthetic request'}))change(name,value);
 else change('organizerName','Test Organizer');
 return {render,find,change,submit,stop,replay,writes,requests,get closed(){return closed;},close:()=>find(n=>n.type==='button'&&n.props.children==='Cancel').props.onClick(),get text(){return JSON.stringify(render());}};
}
for(const kind of ['support','event']){
 test(kind+': synchronous repeated submits send exactly one request',async()=>{
  const pending=later(),h=harness(kind,()=>pending.promise),old=h.find(n=>n.type==='form').props.onSubmit;
  const first=old({preventDefault(){}}),second=old({preventDefault(){}});assert.equal(h.requests.length,1);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,true);
  pending.resolve(response(kind));await Promise.all([first,second]);await old({preventDefault(){}});assert.equal(h.requests.length,1);assert.match(h.text,kind==='event'?/EVT-000123/:/Your message has been sent/);h.stop();
 });
 test(kind+': lock covers response body parsing as well as fetch',async()=>{
  const pending=later(),h=harness(kind,async()=>response(kind,{json:()=>pending.promise})),old=h.find(n=>n.type==='form').props.onSubmit,work=old({preventDefault(){}});await new Promise(setImmediate);const duplicate=old({preventDefault(){}}),count=h.requests.length;pending.resolve(kind==='event'?{ok:true,reference:'EVT-000456'}:{ok:true});await Promise.all([work,duplicate]);assert.equal(count,1);h.stop();
 });
 test(kind+': malformed or unconfirmed HTTP success never shows success',async()=>{
  const bodies=[null,{}, {ok:false},{ok:'true'},...(kind==='event'?[{ok:true},{ok:true,reference:42},{ok:true,reference:'  '}]:[])];
  for(const body of bodies){const h=harness(kind,async()=>response(kind,{json:async()=>body}));await h.submit();assert.match(h.text,/couldn't confirm whether/);assert.doesNotMatch(h.text,/Your message has been sent|Event submitted for review/);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);h.stop();}
 });
 test(kind+': invalid JSON is an uncertain result, not a success',async()=>{
  const h=harness(kind,async()=>response(kind,{json:async()=>{throw Error('Invalid JSON');}}));await assert.doesNotReject(h.submit());assert.match(h.text,/check with ParkShare Support/);assert.doesNotMatch(h.text,/Your message has been sent|Event submitted for review/);h.stop();
 });
 test(kind+': server rejection unlocks explicit retry without an automatic second request',async()=>{
  const h=harness(kind,async n=>n===1?response(kind,{ok:false,json:async()=>({error:'Synthetic unavailable'})}):response(kind));await h.submit();assert.equal(h.requests.length,1);assert.match(h.text,/Synthetic unavailable/);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);await h.submit();assert.equal(h.requests.length,2);assert.match(h.text,kind==='event'?/EVT-000123/:/Your message has been sent/);h.stop();
 });
 test(kind+': rejected fetch is caught and unlocks retry',async()=>{
  const h=harness(kind,async n=>{if(n===1)throw Error('Synthetic network failure');return response(kind);});await assert.doesNotReject(h.submit());assert.match(h.text,/Synthetic network failure/);assert.equal(h.requests.length,1);await h.submit();assert.equal(h.requests.length,2);h.stop();
 });
 test(kind+': unmounted replies and queued submits cannot write or send',async()=>{
  for(const failure of [false,true]){const pending=later(),h=harness(kind,()=>pending.promise),old=h.find(n=>n.type==='form').props.onSubmit,work=old({preventDefault(){}});h.stop();const n=h.writes.length;if(failure)pending.reject(Error('OLD PRIVATE ERROR'));else pending.resolve(response(kind));await assert.doesNotReject(work);await old({preventDefault(){}});assert.equal(h.writes.length,n);assert.equal(h.requests.length,1);}
 });
 test(kind+': unmount during JSON parsing ignores the obsolete result',async()=>{
  const pending=later(),h=harness(kind,async()=>response(kind,{json:()=>pending.promise})),work=h.submit();await new Promise(setImmediate);h.stop();const n=h.writes.length;pending.resolve(kind==='event'?{ok:true,reference:'OLD-REFERENCE'}:{ok:true});await work;assert.equal(h.writes.length,n);
 });
 test(kind+': pending fields cannot change the submitted payload or confirmation',async()=>{
  const pending=later(),h=harness(kind,()=>pending.promise),field=kind==='event'?'organizerName':'name',change=h.find(n=>kind==='event'?n.type==='input'&&n.props?.maxLength===120:n.props?.name==='name').props.onChange,work=h.submit();change({target:{name:field,value:'Changed during request'}});assert.equal(h.requests[0].body[field],kind==='event'?'Test Organizer':'Test Driver');assert.doesNotMatch(h.text,/Changed during request/);if(kind==='event'){assert.equal(h.find(n=>n.type==='fieldset').props.disabled,true);assert.equal(h.find(n=>n.props?.type==='checkbox').props.disabled,true);}pending.resolve(response(kind));await work;h.stop();
 });
 test(kind+': StrictMode replay invalidates old work and allows a fresh attempt',async()=>{
  const pending=later(),h=harness(kind,async n=>n===1?pending.promise:response(kind)),work=h.submit();h.replay();const n=h.writes.length;pending.resolve(response(kind));await work;assert.equal(h.writes.length,n);assert.ok(nodes(h.render(),n=>n.type==='form').length);await h.submit();assert.equal(h.requests.length,2);h.stop();
 });
 test(kind+': request uses the existing endpoint and event discriminator',async()=>{
  const h=harness(kind);await h.submit();assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/contact');assert.equal(h.requests[0].method,'POST');assert.deepEqual(h.requests[0].headers,{'Content-Type':'application/json'});assert.equal(h.requests[0].body.requestType,kind==='event'?'event-submission':undefined);h.stop();
 });
}
test('event: Cancel immediately invalidates pending results and queued submits',async()=>{
 const pending=later(),h=harness('event',()=>pending.promise),old=h.find(n=>n.type==='form').props.onSubmit,work=old({preventDefault(){}});h.close();const n=h.writes.length;pending.resolve(response('event'));await work;await old({preventDefault(){}});assert.equal(h.closed,1);assert.equal(h.writes.length,n);assert.equal(h.requests.length,1);h.stop();
});
test('support: invalid fields do not send or lock the form',async()=>{
 const h=harness('support');h.change('email','invalid');await h.submit();assert.equal(h.requests.length,0);assert.match(h.text,/Please enter a valid email address/);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);h.stop();
});
