import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm} from '../src/lib/authForm.js';
const source=await readFile(process.env.QA_AUTH_EMAIL_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const a=source.indexOf('function SignInModal('),modal=source.slice(a,source.indexOf('// ─── Header',a));
// Expose the real sign-in/signup submit Promise only for deterministic setup.
const compiled=(await transform(modal.replaceAll('event.preventDefault(); void submit();','event.preventDefault(); return submit();'),{loader:'jsx'})).code;
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const accepted=kind=>({data:kind==='resend'?{user:null,session:null}:{},error:null});
function nodes(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);for(const child of React.Children.toArray(node.props?.children))nodes(child,predicate,out);return out;}
function harness({send=async kind=>accepted(kind),verify=false,signIn}={}){
 const slots=[],effects=[],setups=[],writes=[],calls=[],logins=[];let cursor=0,dirty=false,tree,closed=0,clock=100000;
 const values={React,C:{},ResponsiveMascot:()=>null,emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm,Date:class extends Date{static now(){return clock;}},window:{location:{origin:'https://synthetic.invalid'}},buildAppUser:()=>{throw Error('Unexpected authentication');},
 supabase:{auth:{resend:async options=>{calls.push({kind:'resend',...options});return send('resend',calls.length);},resetPasswordForEmail:async(email,options)=>{calls.push({kind:'reset',email,options});return send('reset',calls.length);},signInWithPassword:async value=>{logins.push(value);return signIn?signIn():{error:{message:'Email not confirmed'}};},signUp:async()=>({data:{user:{id:'synthetic'},session:null},error:null})}},
 useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;dirty=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();setups[n]=fn;});}}};
 const Component=new Function(...Object.keys(values),compiled+';return SignInModal;')(...Object.values(values));
 function render(){let count=0;do{dirty=false;cursor=0;tree=Component({initialScreen:verify?'signup':'signin',onClose:()=>closed++,onAuth:()=>{throw Error('No publication expected');}});for(const fn of effects.splice(0))fn();assert.ok(++count<8);}while(dirty);return tree;}
 const find=predicate=>{const n=nodes(render(),predicate)[0];assert.ok(n,'control exists');return n;};
 const input=(field,value)=>find(n=>n.props?.id==='ps-'+(verify&&nodes(tree,n=>n.props?.id==='ps-signup-email').length?'signup':'signin')+'-'+field).props.onChange({target:{value}});
 const sign=()=>find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 const handler=kind=>find(n=>n.type==='button'&&n.props.children===(kind==='resend'?'Resend confirmation email':'Forgot password?')).props.onClick;
 const request=kind=>handler(kind)();
 const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
 const replay=()=>{for(const [n,fn] of setups.entries())if(fn){slots[n].cleanup?.();slots[n].cleanup=fn();}render();};
 const close=()=>find(n=>n.props?.['aria-label']==='Close sign-in dialog').props.onClick();
 const back=()=>find(n=>n.type==='button'&&n.props.children==='←').props.onClick();
 const signup=()=>find(n=>n.type==='button'&&n.props.children==='Sign up free').props.onClick();
 render();if(verify)input('name','Synthetic Driver');input('email','  synthetic@example.invalid  ');input('password','synthetic password');
 return {render,find,input,sign,handler,request,stop,replay,close,back,signup,writes,calls,logins,advance:ms=>clock+=ms,get closed(){return closed;},get text(){return JSON.stringify(render());}};
}
async function prepared(kind,settings={}){const h=harness(settings);if(kind==='resend')await h.sign();return h;}
for(const kind of ['resend','reset']){
 test(kind+': synchronous duplicate handlers send one email request',async()=>{
  const pending=later(),h=await prepared(kind,{send:()=>pending.promise}),old=h.handler(kind),a=old(),b=old(),count=h.calls.length;pending.resolve(accepted(kind));await Promise.all([a,b]);assert.equal(count,1);assert.equal(h.calls.length,1);h.stop();
 });
 test(kind+': confirmed sends enforce one minute even through cached handlers',async()=>{
  const h=await prepared(kind),old=h.handler(kind);await old();await old();assert.equal(h.calls.length,1);assert.match(h.text,/Please wait a minute/);h.advance(59999);await h.request(kind);assert.equal(h.calls.length,1);h.advance(1);await h.request(kind);assert.equal(h.calls.length,2);h.stop();
 });
 test(kind+': Close ignores late replies and blocks queued handlers',async()=>{
  for(const failure of [false,true]){const pending=later(),h=await prepared(kind,{send:()=>pending.promise}),old=h.handler(kind),work=old();h.close();const n=h.writes.length;if(failure)pending.reject(Error('OLD PRIVATE ERROR'));else pending.resolve(accepted(kind));await assert.doesNotReject(work);await old();assert.equal(h.calls.length,1);assert.equal(h.writes.length,n);assert.equal(h.closed,1);h.stop();}
 });
 test(kind+': changing screens cannot revive a late reply or its queued send',async()=>{
  const pending=later(),h=await prepared(kind,{send:()=>pending.promise}),old=h.handler(kind),work=old();h.signup();h.render();h.find(n=>n.type==='button'&&n.props.children==='Sign in').props.onClick();h.render();const n=h.writes.length;pending.resolve(accepted(kind));await work;await old();assert.equal(h.calls.length,1);assert.equal(h.writes.length,n);assert.doesNotMatch(h.text,/fresh confirmation link|password recovery/);h.stop();
 });
 test(kind+': unmount ignores pending successes and failures',async()=>{
  for(const failure of [false,true]){const pending=later(),h=await prepared(kind,{send:()=>pending.promise}),old=h.handler(kind),work=old();h.stop();const n=h.writes.length;if(failure)pending.reject(Error('OLD PRIVATE ERROR'));else pending.resolve(accepted(kind));await assert.doesNotReject(work);await old();assert.equal(h.writes.length,n);assert.equal(h.calls.length,1);}
 });
 test(kind+': current server and network failures unlock explicit retry',async()=>{
  for(const thrown of [false,true]){const h=await prepared(kind,{send:async(k,n)=>{if(n===1){if(thrown)throw Error('Synthetic email outage');return {data:null,error:{message:'Synthetic email outage'}};}return accepted(k);}});await assert.doesNotReject(h.request(kind));assert.equal(h.calls.length,1);assert.match(h.text,/Synthetic email outage/);assert.equal(h.find(n=>n.type==='button'&&n.props.children===(kind==='resend'?'Resend confirmation email':'Forgot password?')).props.disabled,false);await h.request(kind);assert.equal(h.calls.length,2);assert.match(h.text,kind==='resend'?/If this account still needs verification/:/If this account can use password recovery/);h.stop();}
 });
 test(kind+': malformed replies do not claim success or start cooldown',async()=>{
  for(const result of [null,undefined,{}, {data:{}},{data:null,error:null},{data:[],error:null}]){const h=await prepared(kind,{send:async(k,n)=>n===1?result:accepted(k)});await assert.doesNotReject(h.request(kind));assert.doesNotMatch(h.text,/fresh confirmation link has been sent|If this account can use password recovery/);assert.match(h.text,/confirm the email request/);await h.request(kind);assert.equal(h.calls.length,2);h.stop();}
 });
 test(kind+': pending controls and cached changes cannot change the address',async()=>{
  const pending=later(),h=await prepared(kind,{send:()=>pending.promise}),email=h.find(n=>n.props?.id==='ps-signin-email'),work=h.request(kind);email.props.onChange({target:{value:'changed@example.invalid'}});assert.equal(h.find(n=>n.props?.id==='ps-signin-email').props.value,'  synthetic@example.invalid  ');assert.equal(h.find(n=>n.props?.id==='ps-signin-email').props.disabled,true);assert.equal(h.find(n=>n.props?.id==='ps-signin-password').props.disabled,true);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,true);assert.equal(h.calls[0].email,'synthetic@example.invalid');pending.resolve(accepted(kind));await work;h.stop();
 });
 test(kind+': email A to B to A rejects the obsolete email handler',async()=>{
  const h=await prepared(kind),old=h.handler(kind);h.input('email','other@example.invalid');h.render();h.input('email','  synthetic@example.invalid  ');h.render();await old();assert.equal(h.calls.length,0);h.stop();
 });
 test(kind+': StrictMode cleanup/setup ignores old pending work and unlocks the form',async()=>{
  const pending=later(),h=await prepared(kind,{send:async(k,n)=>n===1?pending.promise:accepted(k)}),work=h.request(kind);h.replay();const n=h.writes.length;pending.resolve(accepted(kind));await work;assert.equal(h.writes.length,n);h.advance(60000);if(kind==='resend')await h.sign();await h.request(kind);assert.equal(h.calls.length,2);h.stop();
 });
}
test('resend and reset share a lock while an email is pending, and credentials cannot start',async()=>{
 for(const first of ['resend','reset']){const pending=later(),h=await prepared('resend',{send:()=>pending.promise}),resend=h.handler('resend'),reset=h.handler('reset'),sign=h.find(n=>n.type==='form').props.onSubmit,a=(first==='resend'?resend:reset)(),b=(first==='resend'?reset:resend)(),c=sign({preventDefault(){}}),count=h.calls.length,loginCount=h.logins.length;pending.resolve(accepted(first));await Promise.all([a,b,c]);assert.equal(count,1);assert.equal(loginCount,1);h.stop();}
});
test('email requests cannot start while sign-in is pending',async()=>{
 const pending=later(),h=harness({signIn:()=>pending.promise}),reset=h.handler('reset'),work=h.sign();await reset();assert.equal(h.calls.length,0);pending.resolve({error:{message:'Synthetic auth failure'}});await work;h.stop();
});
test('reset validates a full email address before contacting Auth',async()=>{
 for(const value of ['','name@','@domain.com','bad address@example.com']){const h=harness();h.input('email',value);await h.request('reset');assert.equal(h.calls.length,0);assert.match(h.text,/Enter a valid email/);h.stop();}
});
test('confirmation and reset keep signup type and same-origin link options',async()=>{
 const h=await prepared('resend');await h.request('resend');await h.request('reset');assert.deepEqual(h.calls,[{kind:'resend',type:'signup',email:'synthetic@example.invalid',options:{emailRedirectTo:'https://synthetic.invalid'}},{kind:'reset',email:'synthetic@example.invalid',options:{redirectTo:'https://synthetic.invalid'}}]);h.stop();
});
async function verification(settings={}){
 const h=harness({...settings,verify:true});await h.sign();h.find(n=>n.type==='button'&&nodes(n,c=>c.props?.children==='Find a driveway').length).props.onClick();h.render();h.find(n=>n.type==='input'&&n.props?.type==='checkbox').props.onChange({target:{checked:true}});h.render();await h.find(n=>n.type==='button'&&n.props.children==='I Agree & Create Account').props.onClick();h.render();return h;
}
test('verification Reset transfers ownership to sign-in and sends once to the registered address',async()=>{
 const pending=later(),h=await verification({send:()=>pending.promise}),old=h.find(n=>n.type==='button'&&n.props.children==='Reset password').props.onClick,work=old();h.render();assert.equal(h.find(n=>n.props?.id==='ps-signin-email').props.value,'synthetic@example.invalid');assert.equal(h.calls.length,1);const n=h.writes.length;await old();assert.equal(h.calls.length,1);assert.equal(h.writes.length,n);pending.resolve(accepted('reset'));await work;assert.match(h.text,/If this account can use password recovery/);h.stop();
});
test('verification resend is retired by Sign in to existing account without stale messages',async()=>{
 const pending=later(),h=await verification({send:()=>pending.promise}),old=h.find(n=>n.type==='button'&&n.props.children==='Sign in to existing account').props.onClick,work=h.request('resend');old();h.render();const n=h.writes.length;old();pending.resolve(accepted('resend'));await work;assert.equal(h.writes.length,n);assert.doesNotMatch(h.text,/fresh confirmation link/);assert.equal(h.calls.length,1);h.stop();
});
