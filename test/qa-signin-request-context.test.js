import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm} from '../src/lib/authForm.js';
const source=await readFile(process.env.QA_SIGNIN_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const a=source.indexOf('function SignInModal('),modal=source.slice(a,source.indexOf('// ─── Header',a));
// Expose the real submit Promise for deterministic awaiting; handler logic is unchanged.
const compiled=await transform(modal.replace('event.preventDefault(); void submit();','event.preventDefault(); return submit();'),{loader:'jsx'});
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const authUser=(id='A')=>({id,email:id+'@example.invalid',user_metadata:{role:'driver'}});
const session=id=>({data:{session:id?{user:authUser(id),access_token:id+'-token'}:null},error:null});
const signed=(id='A')=>({data:{user:authUser(id),session:session(id).data.session},error:null});
const profile=(id='A',role='driver')=>({data:{id,name:id+' Driver',role},error:null});
function nodes(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);for(const child of React.Children.toArray(node.props?.children))nodes(child,predicate,out);return out;}
function harness({signIn=async()=>signed(),getSession=async()=>session('A'),readProfile=async()=>profile(),closeOnAuth=true}={}){
 const slots=[],effects=[],setups=[],writes=[],logins=[],profiles=[],sessionReads=[],published=[];let cursor=0,dirty=false,tree,closed=0;
 const values={React,C:{},ResponsiveMascot:()=>null,emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm,window:{location:{origin:'https://synthetic.invalid'}},buildAppUser:(p,u)=>({id:p.id,name:p.name,role:p.role,email:u.email}),supabase:{auth:{signInWithPassword:async credentials=>{logins.push(credentials);return signIn(logins.length);},getSession:async()=>{sessionReads.push(true);return getSession(sessionReads.length);},resetPasswordForEmail:async()=>{throw Error('no real recovery in sign-in tests');}},from:table=>({select:fields=>({eq:(field,id)=>({single:async()=>{profiles.push({table,fields,field,id});return readProfile(profiles.length);}})})})},useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;dirty=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();setups[n]=fn;});}}};
 const Component=new Function(...Object.keys(values),compiled.code+';return SignInModal;')(...Object.values(values));
 function render(){let count=0;do{dirty=false;cursor=0;tree=Component({initialScreen:'signin',closeOnAuth,onClose:()=>closed++,onAuth:u=>published.push(u)});for(const fn of effects.splice(0))fn();assert.ok(++count<8);}while(dirty);return tree;}
 const find=predicate=>{const n=nodes(render(),predicate)[0];assert.ok(n,'control exists');return n;};
 const input=(field,value)=>find(n=>n.props?.id==='ps-signin-'+field).props.onChange({target:{value}});
 const submit=()=>find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
 const close=()=>find(n=>n.props?.['aria-label']==='Close sign-in dialog').props.onClick();
 const switchToSignup=()=>find(n=>n.type==='button'&&n.props?.children==='Sign up free').props.onClick();
 const switchToSignin=()=>find(n=>n.type==='button'&&n.props?.children==='Sign in').props.onClick();
 const replay=()=>{for(const [n,fn] of setups.entries())if(fn){slots[n].cleanup?.();slots[n].cleanup=fn();}render();};
 render();input('email','A@example.invalid');input('password','synthetic password');
 return {render,find,input,submit,stop,close,switchToSignup,switchToSignin,replay,writes,logins,profiles,sessionReads,published,get closed(){return closed;},get text(){return JSON.stringify(render());}};
}

test('rejected sign-in requests show an error and unlock explicit retry',async()=>{
 let calls=0;const h=harness({signIn:async()=>{if(calls++===0)throw Error('Synthetic auth outage');return signed();}});await assert.doesNotReject(h.submit());assert.equal(h.published.length,0);assert.match(h.text,/Synthetic auth outage/);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);await h.submit();assert.equal(h.published.length,1);assert.equal(h.logins.length,2);h.stop();
});
test('duplicate submits stay locked through the profile lookup',async()=>{
 const pending=later(),h=harness({readProfile:()=>pending.promise}),old=h.find(n=>n.type==='form').props.onSubmit,a=old({preventDefault(){}});await tick();const b=old({preventDefault(){}});assert.equal(h.logins.length,1);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,true);pending.resolve(profile());await Promise.all([a,b]);assert.equal(h.published.length,1);h.stop();
});
test('rejected profile lookups are caught and do not leave sign-in stuck',async()=>{
 let calls=0;const h=harness({readProfile:async()=>{if(calls++===0)throw Error('Synthetic profile outage');return profile();}});await assert.doesNotReject(h.submit());assert.equal(h.published.length,0);assert.match(h.text,/Synthetic profile outage/);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);await h.submit();assert.equal(h.published.length,1);h.stop();
});
test('Close invalidates pending profile results and queued old submits immediately',async()=>{
 const pending=later(),h=harness({readProfile:()=>pending.promise}),old=h.find(n=>n.type==='form').props.onSubmit,work=old({preventDefault(){}});await tick();h.close();const n=h.writes.length;pending.resolve(profile());await work;await old({preventDefault(){}});assert.equal(h.published.length,0);assert.equal(h.closed,1);assert.equal(h.logins.length,1);assert.equal(h.writes.length,n);h.stop();
});
test('dismissal or disposal during SDK authentication suppresses modal callbacks and reads',async()=>{
 for(const how of ['close','unmount']){const pending=later(),h=harness({signIn:()=>pending.promise}),work=h.submit();if(how==='close')h.close();else h.stop();const n=h.writes.length;pending.resolve(signed());await work;assert.equal(h.published.length,0);assert.equal(h.profiles.length,0);assert.equal(h.sessionReads.length,0);assert.equal(h.writes.length,n);h.stop();}
});
test('changing screens clears credentials and obsolete sign-in results cannot return',async()=>{
 const pending=later(),h=harness({readProfile:()=>pending.promise}),work=h.submit();await tick();h.switchToSignup();h.render();const n=h.writes.length;pending.resolve(profile());await work;assert.equal(h.published.length,0);assert.equal(h.writes.length,n);assert.doesNotMatch(h.text,/synthetic password|A@example.invalid/);h.stop();
});
test('sign-in to signup to sign-in cannot revive an earlier attempt',async()=>{
 const pending=later(),h=harness({signIn:()=>pending.promise}),old=h.find(n=>n.type==='form').props.onSubmit,work=old({preventDefault(){}});h.switchToSignup();h.render();h.switchToSignin();const n=h.writes.length;pending.resolve(signed());await work;await old({preventDefault(){}});assert.equal(h.logins.length,1);assert.equal(h.published.length,0);assert.equal(h.writes.length,n);h.stop();
});
test('changed or missing stored sessions before profile read or publication cannot authenticate the dialog',async()=>{
 for(const stage of [1,2])for(const id of [null,'B']){const h=harness({getSession:async n=>session(n===stage?id:'A')});await h.submit();assert.equal(h.published.length,0);assert.equal(h.profiles.length,stage===1?0:1);assert.match(h.text,/session changed/);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);h.stop();}
});
test('disposal during final session verification never publishes a late profile',async()=>{
 const pending=later(),h=harness({getSession:async n=>n===1?session('A'):pending.promise}),work=h.submit();await tick();assert.equal(h.profiles.length,1);h.stop();const n=h.writes.length;pending.resolve(session('A'));await work;assert.equal(h.published.length,0);assert.equal(h.writes.length,n);
});
test('malformed authentication and mismatched or missing-role profiles fail visibly',async()=>{
 for(const result of [{data:{}},{data:{user:authUser(),session:null}},{data:{user:authUser(),session:session('B').data.session}}]){const h=harness({signIn:async()=>result});await h.submit();assert.equal(h.published.length,0);assert.equal(h.profiles.length,0);assert.match(h.text,/confirm your sign-in/);h.stop();}
 for(const result of [{data:null},{data:{id:'B',role:'driver'}},{data:{id:'A'}},{data:{id:'A',role:'invalid'}},{data:profile().data,error:{message:'Denied'}}]){const h=harness({readProfile:async()=>result});await h.submit();assert.equal(h.published.length,0);assert.match(h.text,/load your profile/);h.stop();}
});
test('login error preserves unconfirmed-email recovery guidance',async()=>{
 const h=harness({signIn:async()=>({error:{message:'Email not confirmed'}})});await h.submit();assert.equal(h.published.length,0);assert.match(h.text,/Resend confirmation email/);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);h.stop();
});
test('sign-in credentials are captured and editing is locked through profile loading',async()=>{
 const pending=later(),h=harness({readProfile:()=>pending.promise}),work=h.submit();await tick();h.input('email','B@example.invalid');h.input('password','changed');assert.deepEqual(h.logins,[{email:'A@example.invalid',password:'synthetic password'}]);assert.equal(h.find(n=>n.props?.id==='ps-signin-email').props.disabled,true);assert.equal(h.find(n=>n.props?.id==='ps-signin-password').props.disabled,true);assert.equal(h.find(n=>n.props?.children==='Forgot password?').props.disabled,true);assert.equal(h.find(n=>n.props?.id==='ps-signin-email').props.value,'A@example.invalid');pending.resolve(profile());await work;h.stop();
});
test('successful Driver and Host sign-ins use bounded owning profiles and current sessions',async()=>{
 for(const role of ['driver','host']){const h=harness({readProfile:async()=>profile('A',role)});await h.submit();assert.deepEqual(h.profiles,[{table:'profiles',fields:'id, name, role',field:'id',id:'A'}]);assert.equal(h.sessionReads.length,2);assert.deepEqual(h.published,[{id:'A',name:'A Driver',role,email:'A@example.invalid'}]);assert.equal(h.closed,1);assert.doesNotMatch(h.text,/synthetic password/);h.stop();}
});
test('closeOnAuth=false publishes once without dismissing extension-email intent',async()=>{
 const h=harness({closeOnAuth:false});await h.submit();assert.equal(h.published.length,1);assert.equal(h.closed,0);h.stop();
});
test('late provider/profile/session failures after unmount do not write or publish',async()=>{
 for(const stage of ['login','profile','session']){const pending=later(),h=harness({signIn:async()=>stage==='login'?pending.promise:signed(),readProfile:async()=>stage==='profile'?pending.promise:profile(),getSession:async()=>stage==='session'?pending.promise:session('A')}),work=h.submit();await tick();h.stop();const n=h.writes.length;pending.reject(Error('OLD PRIVATE ERROR'));await assert.doesNotReject(work);assert.equal(h.published.length,0);assert.equal(h.writes.length,n);}
});
test('invalid credentials never call authentication or enter a pending state',async()=>{
 const h=harness();h.input('email','invalid');h.input('password','');await h.submit();assert.equal(h.logins.length,0);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);assert.ok(nodes(h.render(),n=>n.props?.role==='alert').length);h.stop();
});
test('StrictMode effect replay invalidates old work and leaves sign-in usable',async()=>{
 const pending=later();let calls=0;const h=harness({signIn:async()=>++calls===1?pending.promise:signed()}),work=h.submit();h.replay();pending.resolve(signed());await work;assert.equal(h.published.length,0);await h.submit();assert.equal(h.published.length,1);h.stop();
});
