import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {validateEventSubmissionForm} from '../src/lib/eventSubmissionValidation.js';
import {validateEventSubmission} from '../api/_event-submission.js';
const source=await readFile(process.env.QA_CONTACT_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const compiled={};
const fieldStart=source.indexOf('function ContactField(');
const fieldCode=(await transform(source.slice(fieldStart,source.indexOf('// ─── Trust & Safety',fieldStart)),{loader:'jsx'})).code;
for(const [kind,name,end] of [['support','ContactPage','// ─── Extend Session'],['event','EventSubmissionForm','// ─── Discover View']]){
 const start=source.indexOf('function '+name+'(');
 compiled[kind]=(kind==='support'?fieldCode:'')+(await transform(source.slice(start,source.indexOf(end,start)),{loader:'jsx'})).code+';return '+name+';';
}
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const response=(kind,extra={})=>({ok:true,json:async()=>kind==='event'?{ok:true,reference:'EVT-000123'}:{ok:true},...extra});
function nodes(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);for(const child of React.Children.toArray(node.props?.children))nodes(child,predicate,out);return out;}
let harnessId=0;
function harness(kind,send=async()=>response(kind),{populate=true}={}){
 const slots=[],effects=[],setups=[],writes=[],requests=[],focused=[];const id=++harnessId;let cursor=0,dirty=false,tree,closed=0;
 const values={React,validateEventSubmissionForm,C:{},Header:()=>null,HomeFooter:()=>null,ResponsiveMascot:()=>null,SUPPORT_EMAIL:'support@example.invalid',EVENT_CATEGORIES:[{value:'community',label:'Community'}],
 fetch:async(url,options)=>{requests.push({url,...options,body:JSON.parse(options.body)});return send(requests.length);},
 useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;dirty=true;}}];},
 useId:()=>`synthetic-${id}-${cursor++}`,
 useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},
 useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();setups[n]=fn;});}}};
 const Component=new Function(...Object.keys(values),compiled[kind])(...Object.values(values));
 function expand(node){if(!React.isValidElement(node))return node;if(typeof node.type==='function'&&node.type.name==='ContactField')return expand(node.type(node.props));return React.cloneElement(node,{},Array.isArray(node.props.children)?node.props.children.map(expand):expand(node.props.children));}
 const formDom={querySelector(selector){assert.equal(selector,'[aria-invalid="true"]');const control=nodes(tree,n=>n.props?.['aria-invalid']===true)[0];return control?{focus(){focused.push({name:control.props.name,invalid:control.props['aria-invalid'],describedBy:control.props['aria-describedby']});}}:null;}};
 function render(){let count=0;do{dirty=false;cursor=0;tree=expand(Component({onClose:()=>closed++}));for(const node of nodes(tree,n=>n.type==='form'&&n.ref))node.ref.current=formDom;for(const fn of effects.splice(0))fn();assert.ok(++count<8);}while(dirty);return tree;}
 const find=predicate=>{const n=nodes(render(),predicate)[0];assert.ok(n,'control exists');return n;};
 const change=(name,value)=>{const control=find(n=>n.props?.name===name||(kind==='event'&&n.props?.onChange?.toString().includes('update("'+name+'",')));control.props.onChange({target:{name,value,checked:value}});};
 const submit=()=>find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
 const replay=()=>{for(const [n,fn] of setups.entries())if(fn){slots[n].cleanup?.();slots[n].cleanup=fn();}render();};
 render();
 if(populate&&kind==='support')for(const [name,value] of Object.entries({name:'Test Driver',email:'driver@example.invalid',helpType:'Booking',message:'Synthetic request'}))change(name,value);
 else if(populate)for(const [name,value]of Object.entries({organizerName:'Test Organizer',organizerEmail:'organizer@example.invalid',eventName:'Synthetic event',venueName:'Synthetic venue',address:'123 Test Street, Toronto ON',eventDate:'2099-11-10',startTime:'12:30',description:'Synthetic event only',authorized:true}))change(name,value);
 return {render,find,change,submit,stop,replay,writes,requests,focused,get closed(){return closed;},close:()=>find(n=>n.type==='button'&&n.props.children==='Cancel').props.onClick(),get text(){return JSON.stringify(render());}};
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

function control(h,name){return h.find(n=>['input','select','textarea'].includes(n.type)&&n.props.name===name);}
function assertError(h,name){
 const field=control(h,name);assert.equal(field.props['aria-invalid'],true,name+' is invalid');
 const ids=field.props['aria-describedby']?.split(/\s+/)||[];assert.ok(ids.length,name+' has error description');
 const descriptions=ids.map(id=>h.find(n=>n.props?.id===id));assert.ok(descriptions.some(n=>n.props.className==='ps-form-field-error'),name+' resolves to its error');
 if(name!=='authorized')assert.equal(h.find(n=>n.type==='label'&&n.props.htmlFor===field.props.id).props.htmlFor,field.props.id);
 return field;
}

test('BUG-005441 Contact empty submission links every required input/select/textarea to an announced error',async()=>{
 const h=harness('support',undefined,{populate:false});await h.submit();
 assert.equal(h.find(n=>n.type==='form').props.noValidate,true);assert.equal(h.requests.length,0);
 assert.equal(nodes(h.render(),n=>n.props?.role==='alert').length,1);
 const ids=[];for(const name of ['name','email','helpType','message']){const field=assertError(h,name);assert.equal(field.props.required,true);ids.push(field.props.id);}
 assert.equal(new Set(ids).size,4);assert.equal(control(h,'reservationNumber').props['aria-invalid'],false);assert.equal(control(h,'reservationNumber').props['aria-describedby'],undefined);
 assert.equal(h.focused[0].name,'name');assert.ok(h.focused[0].describedBy);h.stop();
});

test('BUG-005441 Contact corrections clear only that field and do not steal focus while typing',async()=>{
 const h=harness('support',undefined,{populate:false});await h.submit();h.render();const count=h.focused.length;
 h.change('name','Test Driver');h.render();assert.equal(control(h,'name').props['aria-invalid'],false);assert.equal(control(h,'name').props['aria-describedby'],undefined);
 assertError(h,'email');assert.equal(h.focused.length,count);
 await h.submit();h.render();assert.equal(h.focused.at(-1).name,'email');assert.equal(control(h,'name').props.value,'Test Driver');assert.equal(h.requests.length,0);h.stop();
});

test('BUG-005441 event empty submission shows field errors and consent error instead of browser validation bubbles',async()=>{
 const h=harness('event',undefined,{populate:false});await h.submit();
 assert.equal(h.find(n=>n.type==='form').props.noValidate,true);assert.equal(h.requests.length,0);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);
 for(const name of ['organizerName','organizerEmail','eventName','venueName','address','eventDate','startTime','description','authorized'])assertError(h,name);
 assert.equal(nodes(h.render(),n=>n.props?.role==='alert').length,1);assert.equal(h.focused.at(-1).name,'organizerName');
 assert.equal(control(h,'organizerPhone').props['aria-invalid'],false);assert.equal(control(h,'category').props['aria-invalid'],false);h.stop();
});

test('BUG-005441 event malformed email/date/time/links are field-specific and never send',async()=>{
 const h=harness('event');for(const [name,value]of Object.entries({organizerEmail:'bad',category:'invalid',eventDate:'2099-02-30',startTime:'25:00',endTime:'invalid',ticketUrl:'javascript:alert(1)',eventUrl:'/relative'}))h.change(name,value);
 await h.submit();assert.equal(h.requests.length,0);for(const name of ['organizerEmail','category','eventDate','startTime','endTime','ticketUrl','eventUrl'])assertError(h,name);
 assert.equal(h.focused.at(-1).name,'organizerEmail','focus follows visual DOM order');
 h.change('eventDate','2000-01-01');await h.submit();assert.match(h.text,/today or later/);h.stop();
});

test('BUG-005441 event correction preserves venue-timezone hints and pending values without extra focus moves',async()=>{
 const h=harness('event');h.change('startTime','');h.change('authorized',false);await h.submit();assertError(h,'startTime');assertError(h,'authorized');const count=h.focused.length;
 h.change('startTime','12:30');h.change('authorized',true);h.render();assert.equal(control(h,'startTime').props['aria-invalid'],false);
 const hint=control(h,'startTime').props['aria-describedby'];assert.match(hint,/-timezone$/);assert.match(JSON.stringify(h.find(n=>n.props?.id===hint)),/venue's local time/);
 assert.equal(control(h,'authorized').props['aria-describedby'],undefined);assert.equal(h.focused.length,count);
 await h.submit();assert.equal(h.requests.length,1);assert.equal(h.requests[0].body.authorized,true);assert.equal(validateEventSubmission(h.requests[0].body,new Date('2026-11-01')).error,undefined);h.stop();
});

test('BUG-005441 optional event fields stay optional and overnight schedules remain allowed',()=>{
 const form={organizerName:'Synthetic Organizer',organizerEmail:'organizer@example.invalid',eventName:'Synthetic event',category:'community',venueName:'Venue',address:'123 Test Street',eventDate:'2099-11-10',startTime:'23:30',endTime:'01:00',description:'Synthetic only',authorized:true};
 assert.deepEqual(validateEventSubmissionForm(form,new Date('2026-11-01')),{});
 assert.deepEqual(validateEventSubmissionForm({...form,endTime:'',ticketUrl:'  ',eventUrl:'https://example.invalid/event'},new Date('2026-11-01')),{});
});
