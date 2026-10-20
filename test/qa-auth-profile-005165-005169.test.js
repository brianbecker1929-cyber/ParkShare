import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformSync} from 'esbuild';
import {signupOutcome} from '../src/lib/authForm.js';
import {validateDriverProfile,getDriverProfileCompletion} from '../src/lib/driverProfile.js';
const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const source=readFileSync(new URL('../api/profile.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');
const method=(req,res,verb)=>{if(req.method===verb)return true;res.status(405).json({error:'Method not allowed'});return false;};
function response(){return {code:200,status(c){this.code=c;return this;},json(v){this.value=v;return this;},setHeader(){}};}
test('duplicate and genuine unconfirmed signup receive the same non-success guidance',()=>{
 for(const identities of [[],[{id:'new-identity'}],undefined])assert.deepEqual(signupOutcome({user:{id:'synthetic',identities},session:null}),{kind:'pending'});
 for(const error of [{code:'user_already_exists'},{code:'email_exists'},{message:'User already registered'}])assert.deepEqual(signupOutcome(null,error),{kind:'pending'});
 assert.equal(signupOutcome({user:{id:'real'},session:{access_token:'synthetic'}}).kind,'authenticated');
 assert.equal(signupOutcome({user:null}).kind,'error');assert.equal(signupOutcome(null,{message:'Rate limited'}).message,'Rate limited');
});
test('Host/unknown profile requests fail before mutations even with forged Driver metadata',async()=>{
 for(const role of ['host','admin',null]){
  let mutations=0;const admin={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:role?{role}:null})})}),update:()=>{mutations++;throw Error('unexpected update');}}),auth:{admin:{updateUserById:()=>{mutations++;}}}};
  const handler=new Function('jsonMethod','requireUser','supabaseAdmin','validateDriverProfile','getDriverProfileCompletion',source)(method,async()=>({id:'self',user_metadata:{role:'driver'}}),admin,validateDriverProfile,getDriverProfileCompletion);
  const res=response();await handler({method:'PATCH',body:{name:'Host',vehicleMake:'Honda',role:'driver'}},res);
  assert.equal(res.code,403);assert.equal(mutations,0);
 }
});
test('Driver profile updates still work and use only the authenticated user ID',async()=>{
 const writes=[];const admin={from:table=>({select:()=>({eq:(field,id)=>({maybeSingle:async()=>{assert.equal(id,'self');return {data:{role:'driver'}};}})}),update:value=>({eq:async(field,id)=>{writes.push([table,id,value]);return {};}})}),auth:{admin:{updateUserById:async(id,value)=>{writes.push(['auth',id,value]);return {};}}}};
 const handler=new Function('jsonMethod','requireUser','supabaseAdmin','validateDriverProfile','getDriverProfileCompletion',source)(method,async()=>({id:'self',user_metadata:{role:'host'}}),admin,validateDriverProfile,getDriverProfileCompletion);
 const res=response();await handler({method:'PATCH',body:{name:'Driver',userId:'someone-else',phone:''}},res);
 assert.equal(res.code,200);assert.equal(writes.length,2);assert.ok(writes.every(w=>w[1]==='self'));
});
test('role query failure and invalid sessions cannot modify a profile',async()=>{
 for(const mode of ['outage','anonymous']){
  const admin={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({error:Error('unavailable')})})})})};
  const handler=new Function('jsonMethod','requireUser','supabaseAdmin','validateDriverProfile','getDriverProfileCompletion',source)(method,async(req,res)=>{if(mode==='anonymous'){res.status(401).json({});return null;}return {id:'self'};},admin,validateDriverProfile,getDriverProfileCompletion);
  const res=response();await handler({method:'PATCH',body:{name:'Driver'}},res);assert.equal(res.code,mode==='anonymous'?401:500);
 }
});
test('direct /profile route blocks Host rendering and provides a safe dashboard destination',()=>{
 const start=app.indexOf('  const requireDriver = '),end=app.indexOf('  const requireAuth = ',start);
 assert.ok(start>0);const code=transformSync(app.slice(start,end)+'\nreturn requireDriver;',{loader:'jsx',jsx:'transform'}).code;
 for(const role of ['host','driver',null]){
  let nav;const gate=new Function('React','user','changeTab','setShowAuth','C',code)(React,role?{role}:null,x=>nav=x,()=>{},{});
  const result=gate(React.createElement('p',null,'Vehicle editor'));const html=renderToStaticMarkup(result);
  assert.equal(html.includes('Vehicle editor'),role==='driver');
  if(role==='host'){result.props.children.find(e=>e.type==='button').props.onClick();assert.equal(nav,'Host Dashboard');}
 }
 assert.match(app,/tab === "Profile" && requireDriver\(<DriverProfileView/);
});

// Execute the actual JSX component with isolated hooks and synthetic Auth;
// never register an account or send an email during regression tests.
import {emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,validateAuthForm} from '../src/lib/authForm.js';
const modalStart=app.indexOf('function SignInModal('),modalEnd=app.indexOf('// ─── Header',modalStart);
const modalCode=transformSync(app.slice(modalStart,modalEnd),{loader:'jsx',jsx:'transform'}).code;
const visit=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(visit):[n,...visit(n.props?.children)];
function signupHarness(result,throwing=false){
 const state=[];let index=0,root;const events=[];
 const hooks={useState(initial){const i=index++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];}};
 const supabase={auth:{signUp:async()=>{events.push('signup');if(throwing)throw Error('offline');return result;},resetPasswordForEmail:async(email)=>{events.push(['reset',email]);return {data:{},error:null};},resend:async()=>{events.push('resend');return {data:{user:null,session:null},error:null};}}};
 const make=new Function('React','useState','useRef','useEffect','emptyAuthForm','isUnconfirmedEmailError','MIN_NEW_PASSWORD_LENGTH','signupOutcome','validateAuthForm','supabase','C','window','buildAppUser',modalCode+';return SignInModal;');
 const Modal=make(React,hooks.useState,initial=>{const i=index++;if(!(i in state))state[i]={current:initial};return state[i];},()=>{},emptyAuthForm,isUnconfirmedEmailError,MIN_NEW_PASSWORD_LENGTH,signupOutcome,validateAuthForm,supabase,{}, {location:{origin:'https://synthetic.invalid'}},()=>{throw Error('unexpected authentication');});
 const props={initialScreen:'signup',onAuth:()=>events.push('auth'),onClose:()=>events.push('close')};
 function render(){index=0;root=Modal(props);return root;}
 function text(n){return renderToStaticMarkup(n).replace(/<[^>]+>/g,'');}
 const h={events,render,nodes:()=>visit(root),html:()=>renderToStaticMarkup(root),
  input(id,value){visit(root).find(n=>n.props?.id===id).props.onChange({target:{value}});render();},
  async click(label){const n=visit(root).find(n=>n.type==='button'&&text(n)===label);assert.ok(n,`button ${label} exists`);await n.props.onClick();render();},
  async role(){h.input('ps-signup-name','Synthetic Driver');h.input('ps-signup-email','synthetic@example.invalid');h.input('ps-signup-password','synthetic password 123');
   await visit(root).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});render();
  },
  async create(){await h.role();
   // The role picker has a heading child, so match its complete button text.
   const driver=visit(root).find(n=>n.type==='button'&&text(n).includes("Find a driveway"));assert.ok(driver);driver.props.onClick();render();
   visit(root).find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});render();
   await h.click('I Agree &amp; Create Account');
  },
 };
 render();return h;
}
test('duplicate-email JSX gives recovery actions, clears secrets, and never authenticates',async()=>{
 const h=signupHarness({data:{user:{id:'obfuscated',identities:[]},session:null},error:null});await h.create();
 assert.match(h.html(),/Already registered/);assert.match(h.html(),/eligible for a new account/);assert.doesNotMatch(h.html(),/We sent a confirmation/);
 assert.doesNotMatch(h.html(),/synthetic password 123/);assert.deepEqual(h.events,['signup']);
 await h.click('Sign in to existing account');const email=h.nodes().find(n=>n.props?.id==='ps-signin-email');const password=h.nodes().find(n=>n.props?.id==='ps-signin-password');
 assert.equal(email.props.value,'synthetic@example.invalid');assert.equal(password.props.value,'');
});
test('pending signup password recovery uses the entered address and no account lookup',async()=>{
 const h=signupHarness({data:{user:{id:'obfuscated',identities:[]},session:null}});await h.create();await h.click('Reset password');
 assert.deepEqual(h.events,['signup',['reset','synthetic@example.invalid']]);assert.match(h.html(),/password recovery/);
});
test('sign-up network failure stops loading and retains an actionable error',async()=>{
 const h=signupHarness(null,true);await h.create();assert.match(h.html(),/Unable to reach sign-up/);
 const button=h.nodes().find(n=>n.type==='button'&&n.props.children==='I Agree & Create Account');assert.equal(button.props.disabled,false);
});

test('role and disclaimer can close without signing up and clear the pending password',async()=>{
 for(const step of ['role','disclaimer']){
  const h=signupHarness(null);await h.role();
  if(step==='disclaimer'){h.nodes().find(n=>n.type==='button'&&renderToStaticMarkup(n).includes('Find a driveway')).props.onClick();h.render();}
  const close=h.nodes().find(n=>n.props?.['aria-label']==='Close sign-in dialog');
  assert.ok(close,step+' has Close');close.props.onClick();h.render();
  assert.deepEqual(h.events,['close']);assert.doesNotMatch(h.html(),/synthetic password 123/);
 }
});
