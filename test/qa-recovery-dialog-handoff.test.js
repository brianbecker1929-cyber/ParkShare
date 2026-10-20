import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm} from '../src/lib/authForm.js';

const source=await readFile(process.env.QA_RECOVERY_APP_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const syncSource=await readFile(process.env.QA_RECOVERY_SYNC_SOURCE||new URL('../src/lib/authSessionSync.js',import.meta.url),'utf8');
const createAuthSessionSynchronizer=new Function(syncSource.replace('export function','function')+';return createAuthSessionSynchronizer;')();
const session=id=>({access_token:'synthetic-token',user:{id,email:id+'@example.invalid'}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

function syncHarness(){
 let listener,latest=null,profile=async id=>({data:{id,role:'driver'},error:null}),reads=0,unsubscribed=0;
 const changes=[],recoveries=[],tasks=[],notices=[];
 const client={auth:{onAuthStateChange:fn=>{listener=fn;return {data:{subscription:{unsubscribe:()=>unsubscribed++}}};},getSession:async()=>{reads++;return {data:{session:latest}};}},from:()=>({select:()=>({eq:(_,id)=>({single:()=>{reads++;return profile(id);}})})})};
 const stop=createAuthSessionSynchronizer({client,buildUser:(p,u)=>({...p,id:u.id}),onUser:(user,event)=>changes.push({user,event}),onRecovery:()=>recoveries.push('recovery'),onProfileUnavailable:()=>notices.push('profile'),defer:fn=>tasks.push(fn)});
 return {changes,recoveries,tasks,notices,stop,client,emit:(event,value)=>{latest=value;listener(event,value);},profile:fn=>{profile=fn;},run:()=>tasks.shift()(),get reads(){return reads;},get unsubscribed(){return unsubscribed;}};
}

test('recovery clears an already displayed identity without doing reads inside the callback',async()=>{
 const h=syncHarness();h.emit('SIGNED_IN',session('A'));await h.run();assert.equal(h.changes.at(-1).user.id,'A');const before=h.reads;h.emit('PASSWORD_RECOVERY',session('B'));assert.deepEqual(h.changes.at(-1),{user:null,event:'PASSWORD_RECOVERY'});assert.deepEqual(h.recoveries,['recovery']);assert.equal(h.reads,before);assert.equal(h.tasks.length,0);h.stop();
});
test('recovery retires a queued profile hydration, even for the same account',async()=>{
 const h=syncHarness();h.emit('SIGNED_IN',session('A'));h.emit('PASSWORD_RECOVERY',session('A'));await h.run();assert.equal(h.reads,0);assert.equal(h.changes.filter(x=>x.user).length,0);h.stop();
});
test('recovery retires an in-flight profile success for the same or a different account',async()=>{
 for(const id of ['A','B']){const pending=deferred(),h=syncHarness();h.profile(()=>pending.promise);h.emit('SIGNED_IN',session('A'));const work=h.run();await Promise.resolve();h.emit('PASSWORD_RECOVERY',session(id));pending.resolve({data:{id:'A',role:'host'},error:null});await work;assert.equal(h.changes.filter(x=>x.user).length,0);assert.deepEqual(h.changes.at(-1),{user:null,event:'PASSWORD_RECOVERY'});h.stop();}
});
test('an obsolete profile failure cannot replace recovery with a profile warning',async()=>{
 const pending=deferred(),h=syncHarness();h.profile(()=>pending.promise);h.emit('SIGNED_IN',session('A'));const work=h.run();await Promise.resolve();h.emit('PASSWORD_RECOVERY',session('B'));pending.reject(Error('Old profile outage'));await work;assert.deepEqual(h.notices,[]);assert.equal(h.changes.at(-1).event,'PASSWORD_RECOVERY');h.stop();
});
test('missing recovery sessions clear identity without opening a password editor',()=>{
 for(const value of [null,undefined,{}, {user:{}},{user:{id:''}}]){const h=syncHarness();h.emit('PASSWORD_RECOVERY',value);assert.equal(h.recoveries.length,0);assert.deepEqual(h.changes,[{user:null,event:'PASSWORD_RECOVERY'}]);h.stop();}
});
test('a subsequent real auth event can hydrate the current recovery account normally',async()=>{
 const h=syncHarness();h.emit('PASSWORD_RECOVERY',session('B'));h.emit('USER_UPDATED',session('B'));await h.run();assert.equal(h.changes.at(-1).user.id,'B');assert.equal(h.changes.at(-1).event,'USER_UPDATED');h.stop();
});
test('unsubscribe prevents later recovery notifications and clears pending work',async()=>{
 const h=syncHarness();h.emit('SIGNED_IN',session('A'));const before=h.changes.slice();h.stop();h.emit('PASSWORD_RECOVERY',session('B'));await h.run();assert.equal(h.unsubscribed,1);assert.deepEqual(h.changes,before);assert.deepEqual(h.recoveries,[]);assert.equal(h.reads,0);
});

// Compile the real App auth state, subscription and overlay JSX, and the real
// SignInModal. The small renderer applies React's type/key mount rule and runs
// the actual effect cleanup when a dialog is replaced; no live Auth is used.
const stateStart=source.indexOf('  const [showAuth, setShowAuth]'),stateEnd=source.indexOf('  const [browseKey',stateStart);
const effectStart=source.indexOf('  useEffect(() => createAuthSessionSynchronizer({'),effectEnd=source.indexOf('  }), []);',effectStart)+'  }), []);'.length;
const overlayStart=source.indexOf('      {showAuth &&'),overlayEnd=source.indexOf('      {navigationRequest &&',overlayStart);
const extensionStart=source.indexOf('      {extendBookingId &&',overlayEnd),extensionEnd=source.indexOf('\n    </>',extensionStart);
const parentCode=(await transform('function Parent({messageBookingId,extendBookingId}){const [user,setUser]=useState(null);'+source.slice(stateStart,stateEnd)+source.slice(effectStart,effectEnd)+';return {user,setUser,open:()=>setShowAuth(true),tree:<> '+source.slice(overlayStart,overlayEnd)+source.slice(extensionStart,extensionEnd)+' </>};}',{loader:'jsx'})).code;
const modalStart=source.indexOf('function SignInModal('),modalCode=(await transform(source.slice(modalStart,source.indexOf('// ─── Header',modalStart)).replace('event.preventDefault(); void updatePassword();','event.preventDefault(); return updatePassword();'),{loader:'jsx'})).code;
function elements(tree,predicate,out=[]){if(!tree||typeof tree!=='object')return out;if(predicate(tree))out.push(tree);React.Children.forEach(tree.props?.children,child=>elements(child,predicate,out));return out;}

function appHarness({messageBookingId=null,extendBookingId=null,update=async()=>({data:{user:{id:'B'}},error:null})}={}){
 let current,listener,parentResult,children=[],closedMessage=0,closedExtension=0;
 const authCalls=[],published=[],tasks=[];
 const hooks={useState:initial=>{const i=current.cursor++,r=current;if(!(i in r.slots))r.slots[i]={value:typeof initial==='function'?initial():initial};return [r.slots[i].value,v=>{r.writes++;const next=typeof v==='function'?v(r.slots[i].value):v;if(next!==r.slots[i].value){r.slots[i].value=next;r.dirty=true;}}];},useRef:initial=>{const i=current.cursor++;return current.slots[i]||(current.slots[i]={current:initial});},useEffect:(fn,deps)=>{const i=current.cursor++,r=current,old=r.slots[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){r.slots[i]={deps,cleanup:old?.cleanup};r.effects.push(()=>{r.slots[i].cleanup?.();r.slots[i].cleanup=fn();});}}};
 const SignInModal=()=>null,ExtendSessionModal=()=>null;
 const supabase={auth:{onAuthStateChange:fn=>{listener=fn;return {data:{subscription:{unsubscribe(){}}}};},updateUser:async value=>{authCalls.push(value);return update();}}};
 const values={React,...hooks,supabase,createAuthSessionSynchronizer:options=>createAuthSessionSynchronizer({...options,defer:fn=>tasks.push(fn)}),buildAppUser:p=>p,SignInModal,ExtendSessionModal,handleAuth:u=>published.push(u),closeEmailListing:()=>closedMessage++,setExtendBookingId:()=>closedExtension++,isExtensionContextCurrent:()=>true,C:{},ResponsiveMascot:()=>null,emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm,window:{location:{origin:'https://synthetic.invalid'}}};
 const Parent=new Function(...Object.keys(values),parentCode+';return Parent;')(...Object.values(values));
 const Modal=new Function(...Object.keys(values),modalCode+';return SignInModal;')(...Object.values(values));
 const runtime=()=>({slots:[],effects:[],cursor:0,dirty:false,writes:0});
 const root=runtime();
 function renderRuntime(r,fn){let result,n=0;do{r.cursor=0;r.dirty=false;current=r;result=fn();for(const effect of r.effects.splice(0))effect();assert.ok(++n<10);}while(r.dirty);return result;}
 const stop=r=>{for(const slot of r.slots)slot?.cleanup?.();};
 function render(){parentResult=renderRuntime(root,()=>Parent({messageBookingId,extendBookingId}));const overlays=elements(parentResult.tree,n=>n.type===SignInModal||n.type===ExtendSessionModal);const next=[];for(const [index,element] of overlays.entries()){let child=children.find(c=>c.index===index&&c.element.key===element.key&&c.element.type===element.type);if(!child)child={index,element,runtime:runtime()};child.element=element;if(element.type===SignInModal)child.tree=renderRuntime(child.runtime,()=>Modal(element.props));next.push(child);}for(const old of children)if(!next.includes(old))stop(old.runtime);children=next;return children;}
 const find=predicate=>{const node=elements(render()[0]?.tree,predicate)[0];assert.ok(node,'control exists');return node;};
 const input=(id,value)=>find(n=>n.type==='input'&&n.props.id===id).props.onChange({target:{value}});
 render();
 return {render,find,input,authCalls,published,tasks,emit:(event,id)=>listener(event,id?session(id):null),open:()=>{parentResult.open();render();},setUser:user=>{parentResult.setUser(user);render();},stop:()=>{stop(root);for(const c of children)stop(c.runtime);},get child(){return children[0];},get user(){return parentResult.user;},get closedMessage(){return closedMessage;},get closedExtension(){return closedExtension;},get text(){return JSON.stringify(render().map(c=>c.tree));}};
}

test('recovery replaces an already-open sign-in dialog with a fresh password form',()=>{
 const h=appHarness();h.open();const old=h.child;h.emit('PASSWORD_RECOVERY','B');h.render();assert.notEqual(h.child,old);assert.equal(h.child.element.props.initialScreen,'recovery');assert.ok(h.find(n=>n.props?.id==='ps-recovery-password'));h.stop();
});
test('a repeated recovery link remounts the editor and clears typed secrets',()=>{
 const h=appHarness();h.emit('PASSWORD_RECOVERY','B');h.render();h.input('ps-recovery-password','typed secret');h.input('ps-recovery-confirm-password','typed secret');const old=h.child;h.emit('PASSWORD_RECOVERY','B');h.render();assert.notEqual(h.child,old);assert.equal(h.find(n=>n.props?.id==='ps-recovery-password').props.value,'');assert.doesNotMatch(h.text,/typed secret/);h.stop();
});
test('recovery takes precedence over message-link sign-in and Close restores its booking context',()=>{
 const h=appHarness({messageBookingId:42});assert.equal(h.child.element.props.initialScreen,'signin');h.emit('PASSWORD_RECOVERY','B');assert.equal(h.render().length,1);assert.equal(h.child.element.props.initialScreen,'recovery');assert.equal(h.closedMessage,0);h.find(n=>n.props?.['aria-label']==='Close sign-in dialog').props.onClick();h.render();assert.equal(h.child.element.props.initialScreen,'signin');assert.equal(h.child.element.props.closeOnAuth,false);assert.equal(h.closedMessage,0);h.child.element.props.onClose();assert.equal(h.closedMessage,1);h.stop();
});
test('recovery takes precedence over extension-link sign-in and preserves explicit cancellation',()=>{
 const h=appHarness({extendBookingId:42});h.emit('PASSWORD_RECOVERY','B');assert.equal(h.render().length,1);assert.equal(h.child.element.props.initialScreen,'recovery');assert.equal(h.closedExtension,0);h.find(n=>n.props?.['aria-label']==='Close sign-in dialog').props.onClick();h.render();assert.equal(h.child.element.props.initialScreen,'signin');assert.equal(h.child.element.props.closeOnAuth,false);h.child.element.props.onClose();assert.equal(h.closedExtension,1);h.stop();
});
test('a signed-in extension dialog is hidden while the primary auth dialog is open',()=>{
 const h=appHarness({extendBookingId:42});h.setUser({id:'A'});assert.equal(h.child.element.props.bookingId,42);h.open();assert.equal(h.render().length,1);assert.equal(h.child.element.props.initialScreen,'landing');h.stop();
});
test('late password responses and cached handlers from a replaced editor cannot affect its replacement',async()=>{
 for(const reject of [false,true]){const pending=deferred(),h=appHarness({update:()=>pending.promise});h.emit('PASSWORD_RECOVERY','B');h.render();h.input('ps-recovery-password','synthetic password');h.input('ps-recovery-confirm-password','synthetic password');const old=h.child,handler=h.find(n=>n.type==='form').props.onSubmit,work=handler({preventDefault(){}});h.emit('PASSWORD_RECOVERY','B');h.render();const oldWrites=old.runtime.writes,newWrites=h.child.runtime.writes;if(reject)pending.reject(Error('Obsolete private error'));else pending.resolve({data:{user:{id:'B'}},error:null});await work;await handler({preventDefault(){}});assert.equal(old.runtime.writes,oldWrites);assert.equal(h.child.runtime.writes,newWrites);assert.equal(h.authCalls.length,1);assert.equal(h.published.length,0);assert.doesNotMatch(h.text,/Your password has been updated|Obsolete private error|synthetic password/);h.stop();}
});
test('closing recovery resets the next primary dialog to landing',()=>{
 const h=appHarness();h.emit('PASSWORD_RECOVERY','B');h.render();h.find(n=>n.props?.['aria-label']==='Close sign-in dialog').props.onClick();assert.equal(h.render().length,0);h.open();assert.equal(h.child.element.props.initialScreen,'landing');h.stop();
});
test('App recovery clears the previous displayed account before showing the password form',()=>{
 const h=appHarness();h.setUser({id:'A',role:'host'});h.emit('PASSWORD_RECOVERY','B');h.render();assert.equal(h.user,null);assert.equal(h.child.element.props.initialScreen,'recovery');h.stop();
});
