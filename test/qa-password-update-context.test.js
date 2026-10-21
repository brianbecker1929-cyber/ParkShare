import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {RECOVERY_SESSION_CHANGED} from '../src/lib/passwordRecovery.js';
import {emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm} from '../src/lib/authForm.js';
const source=await readFile(process.env.QA_PASSWORD_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const a=source.indexOf('function SignInModal('),modal=source.slice(a,source.indexOf('// ─── Header',a));
// Expose the same recovery submit Promise for deterministic awaiting.
const compiled=(await transform(modal.replace('event.preventDefault(); void updatePassword();','event.preventDefault(); return updatePassword();'),{loader:'jsx'})).code;
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const updated=()=>({data:{user:{id:'synthetic-user'}},error:null});
function nodes(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);for(const child of React.Children.toArray(node.props?.children))nodes(child,predicate,out);return out;}
function harness({update=async()=>updated(),recoveryAccountId='synthetic-user'}={}){
 const listeners=new Set();
 const slots=[],effects=[],setups=[],writes=[],updates=[],published=[],completed=[];let cursor=0,dirty=false,tree,closed=0;
 const values={React,RECOVERY_SESSION_CHANGED,C:{},ResponsiveMascot:()=>null,emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm,window:{location:{origin:'https://synthetic.invalid'}},buildAppUser:()=>{throw Error('No profile publication expected');},
 supabase:{auth:{onAuthStateChange:fn=>{listeners.add(fn);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},updateUser:async value=>{updates.push(value);return update(updates.length);}}},
 updateRecoveryPasswordForAccount:async({password})=>{updates.push({password});return update(updates.length);},
 useState:initial=>{const n=cursor++;if(!(n in slots))slots[n]={value:typeof initial==='function'?initial():initial};return [slots[n].value,v=>{writes.push(n);const next=typeof v==='function'?v(slots[n].value):v;if(next!==slots[n].value){slots[n].value=next;dirty=true;}}];},useRef:initial=>{const n=cursor++;return slots[n]||(slots[n]={current:initial});},useEffect:(fn,deps)=>{const n=cursor++,old=slots[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){slots[n]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();setups[n]=fn;});}}};
 const Component=new Function(...Object.keys(values),compiled+';return SignInModal;')(...Object.values(values));
 function render(){let count=0;do{dirty=false;cursor=0;tree=Component({initialScreen:'recovery',recoveryAccountId,onRecoveryComplete:()=>completed.push('complete'),onClose:()=>closed++,onAuth:u=>published.push(u)});for(const fn of effects.splice(0))fn();assert.ok(++count<8);}while(dirty);return tree;}
 const find=predicate=>{const n=nodes(render(),predicate)[0];assert.ok(n,'control exists');return n;};
 const inputs=()=>nodes(render(),n=>n.type==='input'&&n.props?.type==='password');
 const input=(index,value)=>inputs()[index].props.onChange({target:{value}});
 // The previous actual JSX used a button handler instead of a form.
 const handler=()=>nodes(render(),n=>n.type==='form')[0]?.props.onSubmit||find(n=>n.type==='button'&&n.props?.children==='Update password').props.onClick;
 const submit=()=>handler()({preventDefault(){}});
 const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
 const replay=()=>{for(const [n,fn] of setups.entries())if(fn){slots[n].cleanup?.();slots[n].cleanup=fn();}render();};
 const close=()=>find(n=>n.props?.['aria-label']==='Close sign-in dialog').props.onClick();
 render();input(0,'synthetic new password');input(1,'synthetic new password');
 return {render,find,inputs,input,handler,submit,stop,replay,close,writes,updates,published,completed,emit:(event,id)=>{for(const fn of [...listeners])fn(event,id?{access_token:'synthetic-token',user:{id}}:null);},get closed(){return closed;},get text(){return JSON.stringify(render());}};
}

test('recovery account switch clears secrets and retires queued submits even if the old account returns',async()=>{
 const h=harness(),old=h.handler();h.emit('SIGNED_IN','other-user');h.render();
 assert.ok(h.inputs().every(n=>n.props.value===''));assert.ok(h.inputs().every(n=>n.props.disabled));
 h.emit('SIGNED_IN','synthetic-user');await old({preventDefault(){}});await h.submit();
 assert.equal(h.updates.length,0);assert.match(h.text,/recovery session changed/i);h.close();assert.equal(h.closed,1);h.stop();
});
test('wrong account reply cannot claim the recovery password was updated',async()=>{
 const h=harness({update:async()=>({data:{user:{id:'other-user'}},error:null})});await h.submit();
 assert.doesNotMatch(h.text,/Your password has been updated/);assert.match(h.text,/confirm your password update/);assert.equal(h.completed.length,0);h.stop();
});
test('sign-out clears recovery secrets and requires a fresh link while keeping Close usable',async()=>{
 const h=harness();h.emit('SIGNED_OUT',null);await h.submit();assert.equal(h.updates.length,0);assert.ok(h.inputs().every(n=>n.props.value===''&&n.props.disabled));assert.match(h.text,/recovery session changed/i);h.close();assert.equal(h.closed,1);h.stop();
});
test('same-account token refresh preserves the draft and a valid completion requests read-only account hydration once',async()=>{
 const h=harness();h.emit('TOKEN_REFRESHED','synthetic-user');h.emit('USER_UPDATED','synthetic-user');assert.ok(h.inputs().every(n=>n.props.value==='synthetic new password'&&!n.props.disabled));await h.submit();assert.match(h.text,/Your password has been updated/);assert.equal(h.completed.length,1);assert.equal(h.updates.length,1);h.stop();
});
test('missing recovery owner cannot submit or edit a password',async()=>{
 const h=harness({recoveryAccountId:null});await h.submit();assert.equal(h.updates.length,0);assert.ok(h.inputs().every(n=>n.props.value===''&&n.props.disabled));h.close();assert.equal(h.closed,1);h.stop();
});
test('account change during an in-flight recovery suppresses success and cannot revive the old draft',async()=>{
 const pending=later(),h=harness({update:()=>pending.promise}),old=h.handler(),work=h.submit();h.emit('SIGNED_IN','other-user');h.render();const count=h.writes.length;pending.resolve(updated());await work;await old({preventDefault(){}});assert.equal(h.writes.length,count);assert.equal(h.updates.length,1);assert.equal(h.completed.length,0);assert.doesNotMatch(h.text,/Your password has been updated|synthetic new password/);h.stop();
});

test('rejected password update is caught, clears loading and allows explicit retry',async()=>{
 const h=harness({update:async n=>{if(n===1)throw Error('Synthetic recovery outage');return updated();}});await assert.doesNotReject(h.submit());assert.equal(h.updates.length,1);assert.match(h.text,/Synthetic recovery outage/);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);await h.submit();assert.equal(h.updates.length,2);assert.match(h.text,/Your password has been updated/);assert.equal(h.published.length,0);h.stop();
});
test('duplicate Enter or submit handlers produce one update through the response',async()=>{
 const pending=later(),h=harness({update:()=>pending.promise}),old=h.handler(),a=old({preventDefault(){}}),b=old({preventDefault(){}});const count=h.updates.length;pending.resolve(updated());await Promise.all([a,b]);assert.equal(count,1);assert.equal(h.updates.length,1);h.stop();
});
test('pending recovery fields are disabled and cached changes cannot alter passwords',async()=>{
 const pending=later(),h=harness({update:()=>pending.promise}),controls=h.inputs(),work=h.submit();for(const control of controls)control.props.onChange({target:{value:'changed password'}});assert.ok(h.inputs().every(n=>n.props.disabled===true));assert.ok(h.inputs().every(n=>n.props.value==='synthetic new password'));assert.deepEqual(h.updates,[{password:'synthetic new password'}]);pending.resolve(updated());await work;h.stop();
});
test('SDK error response stays visible and unlocks one explicit retry',async()=>{
 const h=harness({update:async n=>n===1?{data:{user:null},error:{message:'Synthetic password policy rejection'}}:updated()});await h.submit();assert.match(h.text,/Synthetic password policy rejection/);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);assert.equal(h.updates.length,1);await h.submit();assert.equal(h.updates.length,2);assert.match(h.text,/Your password has been updated/);h.stop();
});
test('unconfirmed or malformed SDK replies cannot claim a successful password update',async()=>{
 for(const result of [undefined,null,{}, {data:{}},{data:{user:null}},{data:{user:{id:''}}},{data:{user:{id:42}}},{data:{user:{id:'  '}}}]){const h=harness({update:async()=>result});await assert.doesNotReject(h.submit());assert.match(h.text,/couldn't confirm your password update/);assert.doesNotMatch(h.text,/Your password has been updated/);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);h.stop();}
});
test('Close invalidates queued submits and ignores late success immediately',async()=>{
 const pending=later(),h=harness({update:()=>pending.promise}),old=h.handler(),work=old({preventDefault(){}});h.close();const n=h.writes.length;pending.resolve(updated());await work;await old({preventDefault(){}});assert.equal(h.updates.length,1);assert.equal(h.writes.length,n);assert.equal(h.closed,1);assert.doesNotMatch(h.text,/synthetic new password/);h.stop();
});
test('an old closed recovery cannot affect a newly opened dialog',async()=>{
 const pending=later(),old=harness({update:()=>pending.promise}),queued=old.handler(),work=queued({preventDefault(){}});old.close();const oldWrites=old.writes.length,fresh=harness();await fresh.submit();const freshWrites=fresh.writes.length;pending.resolve(updated());await work;await queued({preventDefault(){}});assert.equal(old.writes.length,oldWrites);assert.equal(fresh.writes.length,freshWrites);assert.equal(old.updates.length,1);assert.equal(fresh.updates.length,1);assert.match(fresh.text,/Your password has been updated/);assert.doesNotMatch(old.text,/Your password has been updated/);old.stop();fresh.stop();
});
test('unmounted recovery successes and failures never write or publish',async()=>{
 for(const failure of [false,true]){const pending=later(),h=harness({update:()=>pending.promise}),old=h.handler(),work=old({preventDefault(){}});h.stop();const n=h.writes.length;if(failure)pending.reject(Error('OLD PRIVATE ERROR'));else pending.resolve(updated());await assert.doesNotReject(work);await old({preventDefault(){}});assert.equal(h.writes.length,n);assert.equal(h.updates.length,1);assert.equal(h.published.length,0);}
});
test('late error after Close cannot populate another screen',async()=>{
 const pending=later(),h=harness({update:()=>pending.promise}),work=h.submit();h.close();const n=h.writes.length;pending.reject(Error('OLD PRIVATE ERROR'));await assert.doesNotReject(work);assert.equal(h.writes.length,n);assert.doesNotMatch(h.text,/OLD PRIVATE ERROR/);h.stop();
});
test('successful recovery clears both secrets and retires the old handler before rerender',async()=>{
 const h=harness(),old=h.handler();await old({preventDefault(){}});const n=h.writes.length;await old({preventDefault(){}});assert.equal(h.updates.length,1);assert.equal(h.writes.length,n);assert.match(h.text,/Your password has been updated/);assert.doesNotMatch(h.text,/synthetic new password/);assert.equal(h.published.length,0);h.find(n=>n.type==='button'&&n.props.children==='Continue').props.onClick();assert.equal(h.closed,1);h.stop();
});
test('StrictMode effect cleanup/setup rejects old recovery and allows a fresh update',async()=>{
 const pending=later(),h=harness({update:async n=>n===1?pending.promise:updated()}),work=h.submit();h.replay();const n=h.writes.length;pending.resolve(updated());await work;assert.equal(h.writes.length,n);await h.submit();assert.equal(h.updates.length,2);assert.match(h.text,/Your password has been updated/);h.stop();
});
test('short, missing and mismatched passwords do not call Auth or enter loading',async()=>{
 for(const [password,confirmation] of [['short','short'],['synthetic new password',''],['synthetic new password','different password']]){const h=harness();h.input(0,password);h.input(1,confirmation);await h.submit();assert.equal(h.updates.length,0);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);assert.ok(nodes(h.render(),n=>n.props?.role==='alert').length);h.stop();}
});
test('recovery is a native labeled form with the existing twelve-character password policy',()=>{
 const h=harness(),form=h.find(n=>n.type==='form');assert.equal(form.props.noValidate,true);assert.equal(h.find(n=>n.props?.type==='submit').props.disabled,false);const inputs=h.inputs();for(const id of ['ps-recovery-password','ps-recovery-confirm-password']){assert.ok(nodes(h.render(),n=>n.type==='label'&&n.props?.htmlFor===id).length);assert.ok(inputs.some(n=>n.props.id===id&&n.props.autoComplete==='new-password'&&n.props.required));}assert.equal(inputs[0].props.minLength,MIN_NEW_PASSWORD_LENGTH);assert.equal(inputs[0].props.placeholder,'At least 12 characters');assert.ok(inputs.every(n=>!n.props.onKeyDown));h.stop();
});
