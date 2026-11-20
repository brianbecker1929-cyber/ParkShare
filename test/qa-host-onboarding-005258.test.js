import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {renderToStaticMarkup} from 'react-dom/server';
const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
const component=await readFile(new URL('../src/components/HostOnboarding.jsx',import.meta.url),'utf8');
const code=(await transform(component.replace(/^import .*\n/,'').replace('export default ',''),{loader:'jsx'})).code;
const walk=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(walk):[n,...walk(n.props?.children)];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const session=id=>({data:{session:id?{user:{id}}:null}});
function harness({getSession,signOut}={}){
  const slots=[],effects=[],events=[];let index=0,tree,listener,identity='driver',closed=0,active=true;
  const values={React,document:{activeElement:null},
    useState(initial){const n=index++;if(!(n in slots))slots[n]={value:initial};return[slots[n].value,v=>{slots[n].value=typeof v==='function'?v(slots[n].value):v;}];},
    useRef(initial){const n=index++;return slots[n]||(slots[n]={current:initial});},
    useEffect(fn,deps){const n=index++;if(!slots[n]){slots[n]={};effects.push(()=>slots[n].cleanup=fn());}},
  };
  const View=new Function(...Object.keys(values),code+';return HostOnboarding;')(...Object.values(values));
  const auth={onAuthStateChange(fn){listener=fn;return{data:{subscription:{unsubscribe(){active=false;}}}};},
    getSession:async()=>getSession?getSession():session(identity),
    signOut:async options=>{events.push(['signOut',options]);if(signOut)return signOut();identity=null;listener('SIGNED_OUT',null);return{};},
  };
  const render=()=>{index=0;tree=View({accountId:'driver',auth,onClose:()=>closed++,onReady:screen=>events.push(['ready',screen])});for(const fn of effects.splice(0))fn();return tree;};
  const button=label=>walk(render()).find(n=>n.type==='button'&&n.props.children===label);
  const stop=()=>{for(const slot of slots)slot?.cleanup?.();};
  render();return{render,button,events,stop,closed:()=>closed,active:()=>active,emit:(event,id)=>listener(event,id?{user:{id}}:null)};
}
test('Driver CTA opens Host onboarding; Host goes directly to listing; visitor starts signup',()=>{
  const start=app.indexOf('  const handleHostGetStarted = () => {'),end=app.indexOf('  // Driver page CTA:',start);
  for(const role of ['driver','host',null]){
    const events=[],user=role?{id:role,role}:null;
    const fn=new Function('user','openHostAuth','setHostOnboardingAccount','enterApp',app.slice(start,end)+';return handleHostGetStarted;')(user,()=>events.push('signup'),u=>events.push(['onboard',u]),tab=>events.push(tab));
    fn();assert.deepEqual(events,role==='driver'?[['onboard',user]]:role==='host'?['List Your Driveway']:['signup']);
  }
});
test('successful Host auth preserves the listing destination; Driver auth returns to onboarding',()=>{
  const start=app.indexOf('  const handleAuth = (u) => {'),end=app.indexOf('  const handleSignOut =',start);
  for(const role of ['driver','host']){
    const calls=[];
    const fn=new Function('setUser','hostAuthIntent','screen','moveToRoute','setHostOnboardingAccount','messageBookingId',app.slice(start,end)+';return handleAuth;')(()=>{},true,'host',(...args)=>calls.push(args),u=>calls.push(['onboard',u.role]),null);
    fn({id:role,role});assert.deepEqual(calls,role==='host'?[['app','List Your Driveway']]:[['onboard','driver']]);
  }
});
test('onboarding explains separate-account signup; cancel does not sign out or change routes',()=>{
  const h=harness();try{
    const html=renderToStaticMarkup(h.render());
    assert.match(html,/role="dialog"/);assert.match(html,/different email address/);assert.match(html,/Driver account and bookings/);
    h.button('Stay on this page').props.onClick();assert.equal(h.closed(),1);assert.deepEqual(h.events,[]);
  }finally{h.stop();}
});
test('explicit signup and sign-in choices sign out only this session before opening Auth',async()=>{
  for(const [label,screen]of [['Sign out & create Host account','signup'],['Sign out & sign in as Host','signin']]){
    const h=harness();try{await h.button(label).props.onClick();assert.deepEqual(h.events,[['signOut',{scope:'local'}],['ready',screen]]);}finally{h.stop();}
  }
});
test('rapid duplicate clicks and cancel cannot interrupt a pending handoff',async()=>{
  const p=deferred(),h=harness({getSession:()=>p.promise});try{
    const button=h.button('Sign out & create Host account');const one=button.props.onClick(),two=button.props.onClick();
    h.button('Stay on this page').props.onClick();assert.equal(h.closed(),0);assert.equal(h.button('Stay on this page').props.disabled,true);
    p.resolve(session('different'));await Promise.all([one,two]);assert.deepEqual(h.events,[]);assert.match(renderToStaticMarkup(h.render()),/session changed/);
  }finally{h.stop();}
});
test('session mismatch and unmounted or A-B-A account work never sign out a different account',async()=>{
  for(const mode of ['mismatch','unmount','switch']){
    const p=deferred(),h=harness({getSession:()=>p.promise});try{
      const work=h.button('Sign out & create Host account').props.onClick();
      if(mode==='unmount')h.stop();if(mode==='switch'){h.emit('SIGNED_IN','other');h.emit('SIGNED_IN','driver');}
      p.resolve(session(mode==='mismatch'?'other':'driver'));await work;assert.deepEqual(h.events,[]);
    }finally{h.stop();}
  }
});
test('sign-out failure or an unconfirmed sign-out keeps Auth closed and shows a retryable error',async()=>{
  for(const mode of ['error','throw','still-signed-in']){
    const h=harness({signOut:async()=>{if(mode==='throw')throw Error('offline');return mode==='error'?{error:Error('failure')}:{};}});
    try{await h.button('Sign out & create Host account').props.onClick();assert.equal(h.events.length,1);assert.match(renderToStaticMarkup(h.render()),/role="alert"/);assert.equal(h.button('Sign out & create Host account').props.disabled,false);}finally{h.stop();}
  }
});
test('late sign-out results and another account appearing afterward cannot open Host signup',async()=>{
  for(const mode of ['unmount','switch']){
    const p=deferred(),h=harness({signOut:()=>p.promise});try{
      const work=h.button('Sign out & create Host account').props.onClick();await new Promise(r=>setImmediate(r));
      if(mode==='unmount')h.stop();else h.emit('SIGNED_IN','other');
      p.resolve({});await work;assert.equal(h.events.length,1);
    }finally{h.stop();}
  }
});
test('Host signup still requires explicit Host role choice and legal consent; role authorization stays server-owned',()=>{
  assert.match(app,/filter\(r => signupRole !== "host" \|\| r.role === "host"\)/);
  assert.match(app,/signupRole=\{hostAuthIntent \? "host" : null\}/);
  assert.match(app,/!agreed \|\| !pendingUser/);
  assert.match(app,/if \(user\?\.role === "host"\) return content;/);
  assert.doesNotMatch(component,/updateUser|\.from\(|\.update\(/);
});
