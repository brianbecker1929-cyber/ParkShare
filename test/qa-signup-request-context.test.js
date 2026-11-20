import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm,validateNewPassword} from '../src/lib/authForm.js';
const source=await readFile(process.env.QA_SIGNUP_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const a=source.indexOf('function SignInModal('),modal=source.slice(a,source.indexOf('// ─── Header',a));
const compiled=(await transform(modal.replaceAll('event.preventDefault(); void submit();','event.preventDefault(); return submit();'),{loader:'jsx'})).code;
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const user=(id='A')=>({id,email:'synthetic@example.invalid',user_metadata:{role:'driver'}});
const session=(id='A')=>({data:{session:id?{user:user(id),access_token:'synthetic-'+id}:null},error:null});
const signed=()=>({data:{user:user(),session:session().data.session},error:null});
const profile=(role='driver',id='A')=>({data:{id,role,name:'Synthetic User'},error:null});
function nodes(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);for(const child of React.Children.toArray(node.props?.children))nodes(child,predicate,out);return out;}
function harness({signUp=async()=>signed(),getSession=async()=>session(),readProfile=async()=>profile(),closeOnAuth=true}={}){
 const slots=[],effects=[],setups=[],writes=[],registrations=[],profiles=[],sessionReads=[],published=[];let cursor=0,dirty=false,tree,closed=0;
 const values={React,C:{},ResponsiveMascot:()=>null,emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm,validateNewPassword,window:{location:{origin:'https://synthetic.invalid'}},buildAppUser:(p,u)=>({id:p.id,name:p.name,role:p.role,email:u.email}),supabase:{auth:{signUp:async payload=>{registrations.push(payload);return signUp(registrations.length);},getSession:async()=>{sessionReads.push(true);return getSession(sessionReads.length);}},from:table=>({select:fields=>({eq:(field,id)=>({single:async()=>{profiles.push({table,fields,field,id});return readProfile(profiles.length);}})})})},
 useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;dirty=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();setups[n]=fn;});}}};
 const Component=new Function(...Object.keys(values),compiled+';return SignInModal;')(...Object.values(values));
 function render(){let count=0;do{dirty=false;cursor=0;tree=Component({initialScreen:'signup',closeOnAuth,onClose:()=>closed++,onAuth:u=>published.push(u)});for(const fn of effects.splice(0))fn();assert.ok(++count<8);}while(dirty);return tree;}
 const find=predicate=>{const n=nodes(render(),predicate)[0];assert.ok(n,'control exists');return n;};
 const input=(field,value)=>find(n=>n.props?.id==='ps-signup-'+field).props.onChange({target:{value}});
 const toRole=()=>find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 const roleHandler=role=>find(n=>n.type==='button'&&nodes(n,c=>c.props?.children===(role==='host'?'List my driveway':'Find a driveway')).length).props.onClick;
 const pick=role=>roleHandler(role)();
 const agree=value=>find(n=>n.type==='input'&&n.props?.type==='checkbox').props.onChange({target:{checked:value}});
 const handler=()=>find(n=>n.type==='button'&&['I Agree & Create Account','Creating account…'].includes(n.props.children)).props.onClick;
 const create=()=>handler()();
 const back=()=>find(n=>n.type==='button'&&n.props.children==='←').props.onClick();
 const close=()=>find(n=>n.props?.['aria-label']==='Close sign-in dialog').props.onClick();
 const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
 const replay=()=>{for(const [n,fn] of setups.entries())if(fn){slots[n].cleanup?.();slots[n].cleanup=fn();}render();};
 render();input('name','  Synthetic User  ');input('email',' synthetic@example.invalid ');input('password','synthetic signup password');
 return {render,find,input,toRole,roleHandler,pick,agree,handler,create,back,close,stop,replay,writes,registrations,profiles,sessionReads,published,get closed(){return closed;},get text(){return JSON.stringify(render());}};
}
async function ready(settings={}){const h=harness(settings);await h.toRole();h.pick(settings.role||'driver');h.agree(true);return h;}

test('signup locks synchronous duplicate creates through the SDK result',async()=>{
 const pending=later(),h=await ready({signUp:()=>pending.promise}),old=h.handler(),a=old(),b=old(),count=h.registrations.length;pending.resolve(signed());await Promise.all([a,b]);assert.equal(count,1);assert.equal(h.registrations.length,1);assert.equal(h.published.length,1);h.stop();
});
test('signup stays locked through profile and final session lookup',async()=>{
 for(const stage of ['profile','session']){const pending=later(),h=await ready({readProfile:()=>stage==='profile'?pending.promise:profile(),getSession:async n=>stage==='session'&&n===2?pending.promise:session()}),old=h.handler(),work=old();await tick();const duplicate=old(),count=h.registrations.length,disabled=h.find(n=>n.type==='button'&&n.props.children==='Creating account…').props.disabled;pending.resolve(stage==='profile'?profile():session());await Promise.all([work,duplicate]);assert.equal(count,1);assert.equal(disabled,true);assert.equal(h.published.length,1);h.stop();}
});
test('Close during Auth suppresses profile reads, UI replies and queued creates',async()=>{
 const pending=later(),h=await ready({signUp:()=>pending.promise}),old=h.handler(),work=old();h.close();const n=h.writes.length;pending.resolve(signed());await work;await old();assert.equal(h.writes.length,n);assert.equal(h.profiles.length,0);assert.equal(h.sessionReads.length,0);assert.equal(h.registrations.length,1);assert.equal(h.published.length,0);assert.equal(h.closed,1);h.stop();
});
test('Close during profile lookup cannot publish an obsolete signup',async()=>{
 const pending=later(),h=await ready({readProfile:()=>pending.promise}),work=h.create();await tick();h.close();const n=h.writes.length;pending.resolve(profile());await work;assert.equal(h.writes.length,n);assert.equal(h.published.length,0);h.stop();
});
test('unmounted signup and profile failures never write or publish',async()=>{
 for(const stage of ['signup','profile','session']){const pending=later(),h=await ready({signUp:async()=>stage==='signup'?pending.promise:signed(),readProfile:async()=>stage==='profile'?pending.promise:profile(),getSession:async()=>stage==='session'?pending.promise:session()}),work=h.create();await tick();h.stop();const n=h.writes.length;pending.reject(Error('OLD PRIVATE ERROR'));await assert.doesNotReject(work);assert.equal(h.writes.length,n);assert.equal(h.published.length,0);}
});
test('accepted signup profile failures recover through sign-in instead of registering again',async()=>{
 for(const thrown of [false,true]){const h=await ready({readProfile:async()=>{if(thrown)throw Error('Synthetic profile outage');return {data:null,error:{message:'Denied'}};}}),old=h.handler();await assert.doesNotReject(old());assert.match(h.text,/Sign-up was accepted/);assert.equal(h.find(n=>n.props?.id==='ps-signin-email').props.value,'synthetic@example.invalid');assert.equal(h.find(n=>n.props?.id==='ps-signin-password').props.value,'');await old();assert.equal(h.registrations.length,1);assert.equal(h.published.length,0);assert.doesNotMatch(h.text,/synthetic signup password/);h.stop();}
});
test('missing or mismatched stored sessions before or after profile never publish signup',async()=>{
 for(const stage of [1,2])for(const id of [null,'B']){const h=await ready({getSession:async n=>session(n===stage?id:'A')});await h.create();assert.equal(h.published.length,0);assert.equal(h.profiles.length,stage===1?0:1);assert.match(h.text,/Please sign in to continue/);h.stop();}
});
test('missing, foreign or unsupported-role profiles cannot authorize signup',async()=>{
 for(const result of [{data:null},profile('driver','B'),profile('admin'),{data:{id:'A'}},{data:profile().data,error:{message:'Denied'}}]){const h=await ready({readProfile:async()=>result});await h.create();assert.equal(h.published.length,0);assert.match(h.text,/Please sign in to continue/);h.stop();}
});
test('malformed authenticated SDK sessions cannot read profiles or publish signup',async()=>{
 for(const data of [{user:user(),session:{}},{user:user(),session:{access_token:'synthetic',user:user('B')}}]){const h=await ready({signUp:async()=>({data,error:null})});await h.create();assert.equal(h.profiles.length,0);assert.equal(h.published.length,0);assert.match(h.text,/Please sign in to continue/);h.stop();}
});
test('Driver and Host use bounded owning profiles and retain server-owned roles',async()=>{
 for(const role of ['driver','host']){const h=await ready({role,readProfile:async()=>profile(role)});await h.create();assert.equal(h.registrations.length,1);assert.deepEqual(h.profiles,[{table:'profiles',fields:'id, name, role',field:'id',id:'A'}]);assert.equal(h.sessionReads.length,2);assert.equal(h.published.length,1);assert.equal(h.published[0].role,role);assert.equal(h.closed,1);assert.equal(h.registrations[0].options.data.role,role);assert.equal(h.registrations[0].options.data.name,'Synthetic User');assert.equal(h.registrations[0].email,'synthetic@example.invalid');assert.equal(h.registrations[0].password,'synthetic signup password');assert.ok(Number.isFinite(Date.parse(h.registrations[0].options.data.legal_agreed_at)));h.stop();}
 const h=await ready({readProfile:async()=>profile('host')});await h.create();assert.equal(h.published[0].role,'host');h.stop();
});
test('pending and duplicate registrations keep generic verification without authenticating',async()=>{
 for(const result of [{data:{user:{id:'unconfirmed'},session:null}},{data:{user:{id:'obfuscated',identities:[]},session:null}},{error:{code:'user_already_exists'}}]){const h=await ready({signUp:async()=>result}),old=h.handler();await old();const n=h.writes.length;await old();assert.equal(h.registrations.length,1);assert.equal(h.writes.length,n);assert.equal(h.profiles.length,0);assert.equal(h.published.length,0);assert.equal(h.closed,0);assert.match(h.text,/eligible for a new account/);assert.match(h.text,/Already registered/);assert.doesNotMatch(h.text,/synthetic signup password/);h.stop();}
});
test('returned signup errors and rejected Auth calls remain explicit retry without auto retry',async()=>{
 for(const thrown of [false,true]){const h=await ready({signUp:async n=>{if(n===1){if(thrown)throw Error('Offline');return {error:{message:'Synthetic signup failure'}};}return signed();}});await assert.doesNotReject(h.create());assert.equal(h.registrations.length,1);assert.match(h.text,thrown?/Unable to reach sign-up/:/Synthetic signup failure/);assert.equal(h.find(n=>n.type==='button'&&n.props.children==='I Agree & Create Account').props.disabled,false);await h.create();assert.equal(h.registrations.length,2);assert.equal(h.published.length,1);h.stop();}
});
test('Back and consent changes are disabled and guarded while account creation is pending',async()=>{
 const pending=later(),h=await ready({signUp:()=>pending.promise}),back=h.find(n=>n.type==='button'&&n.props.children==='←').props.onClick,consent=h.find(n=>n.props?.type==='checkbox').props.onChange,work=h.create();back();consent({target:{checked:false}});assert.equal(h.find(n=>n.props?.type==='checkbox').props.checked,true);assert.equal(h.find(n=>n.props?.type==='checkbox').props.disabled,true);assert.equal(h.find(n=>n.type==='button'&&n.props.children==='←').props.disabled,true);pending.resolve(signed());await work;assert.equal(h.published.length,1);h.stop();
});
test('role changes require consent again and obsolete consent/create handlers cannot return',async()=>{
 const h=await ready(),old=h.handler(),consent=h.find(n=>n.props?.type==='checkbox').props.onChange;h.back();h.render();h.pick('host');h.render();const n=h.writes.length;consent({target:{checked:true}});await old();assert.equal(h.writes.length,n);assert.equal(h.find(n=>n.props?.type==='checkbox').props.checked,false);await h.create();assert.equal(h.registrations.length,0);h.agree(true);await h.create();assert.equal(h.registrations.length,1);assert.equal(h.registrations[0].options.data.role,'host');h.stop();
});
test('queued role and Back callbacks cannot change a newer signup step',async()=>{
 const h=harness();await h.toRole();const driver=h.roleHandler('driver'),host=h.roleHandler('host');driver();host();h.render();const back=h.find(n=>n.type==='button'&&n.props.children==='←').props.onClick;h.back();h.render();h.pick('host');h.render();const n=h.writes.length;back();assert.equal(h.writes.length,n);h.agree(true);await h.create();assert.equal(h.registrations[0].options.data.role,'host');h.stop();
});
test('successful signup retires cached creates before callbacks and preserves closeOnAuth=false',async()=>{
 const h=await ready({closeOnAuth:false}),old=h.handler();await old();const n=h.writes.length;await old();assert.equal(h.writes.length,n);assert.equal(h.registrations.length,1);assert.equal(h.published.length,1);assert.equal(h.closed,0);assert.match(h.text,/Create free account/);h.stop();
});
test('StrictMode cleanup/setup invalidates old signup work and leaves an explicit retry',async()=>{
 const pending=later(),h=await ready({signUp:async n=>n===1?pending.promise:signed()}),work=h.create();h.replay();const n=h.writes.length;pending.resolve(signed());await work;assert.equal(h.writes.length,n);assert.equal(h.published.length,0);await h.create();assert.equal(h.registrations.length,2);assert.equal(h.published.length,1);h.stop();
});
test('invalid signup fields and missing consent do not create an account',async()=>{
 const h=harness();h.input('email','invalid');await h.toRole();assert.equal(h.registrations.length,0);assert.ok(nodes(h.render(),n=>n.props?.role==='alert').length);h.input('email','valid@example.invalid');await h.toRole();h.pick('driver');await h.create();assert.equal(h.registrations.length,0);assert.equal(h.find(n=>n.type==='button'&&n.props.children==='I Agree & Create Account').props.disabled,true);h.stop();
});
