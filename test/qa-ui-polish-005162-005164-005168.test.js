import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import postcss from 'postcss';
import {normaliseDriverProfile,getDriverProfileCompletion} from '../src/lib/driverProfile.js';
const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
const css=postcss.parse(await readFile(new URL('../src/index.css',import.meta.url),'utf8'));
async function component(name,end,deps={}){
 const source=app.slice(app.indexOf(`function ${name}(`),app.indexOf(end,app.indexOf(`function ${name}(`)));
 const compiled=await transform(source,{loader:'jsx',jsx:'transform'});
 return new Function('deps',`const {${Object.keys(deps)}}=deps;${compiled.code};return ${name};`)(deps);
}
const build=await component('buildAppUser','// Guards',{normaliseDriverProfile,getDriverProfileCompletion});
const welcome=app.slice(app.indexOf('{/* Welcome banner */}'),app.indexOf('{/* Content-sized responsive grid'));
const compiled=await transform(`function Welcome({user}){return <div>${welcome}</div>;}`,{loader:'jsx'});
const Welcome=new Function('React','C','setTab',compiled.code+';return Welcome;')(React,{},()=>{});
test('Host membership uses Auth creation time, ignores editable dates, and survives missing/invalid timestamps',()=>{
 for(const created_at of ['2026-10-01T00:30:00Z','2024-05-31T23:30:00Z',null,'invalid']){
  const user=build({id:'fixture',role:'host'},{created_at,user_metadata:{created_at:'2025-01-01',createdAt:'2025-01-01'}});
  assert.equal(user.createdAt,created_at);
  const html=renderToStaticMarkup(React.createElement(Welcome,{user}));
  if(created_at?.startsWith('2026'))assert.match(html,/Host since October 2026/);
  else if(created_at?.startsWith('2024'))assert.match(html,/Host since May 2024/);
  else assert.doesNotMatch(html,/Host since|Invalid Date|January 2025/);
 }
});
const Link=await component('FindParkingLink','function MessagesView(',{React});
const C={navy:'#000',concrete:'#ddd',muted:'#777'};
for(const name of ['MessagesView','MyBookingsView','TransactionsView']){
 for(const state of ['empty','loading','error'])test(`${name}: Find parking appears only after successful empty load`,async()=>{
  let i=0;
  const deps={React,C,FindParkingLink:Link,useEffect:()=>{},useRef:()=>({current:null}),
   useState:initial=>{const index=i++;return [index===1&&name!=='TransactionsView'?state==='loading':index===2?state==='error'?'Unavailable':'':typeof initial==='function'?initial():initial,()=>{}];},
   useTransactions:()=>({data:{spent:[],earned:[],payouts:[]},loading:state==='loading',error:state==='error'?'Unavailable':''}),
  };
  const View=await component(name,name==='MessagesView'?'// Shared driveway frame':name==='MyBookingsView'?'function ReviewModal(':'function HostDashboard(',deps);
  const html=renderToStaticMarkup(React.createElement(View,{user:{id:'fixture',role:'driver'}}));
  assert.equal(html.includes('href="/parking"'),state==='empty');
  if(name==='TransactionsView'){
   assert.doesNotMatch(html,/What you&#x27;ve earned|Payouts/);
   assert.match(html,/What you&#x27;ve paid/);
  }
 });
}
test('Host messages and Host transaction empty states do not suggest Driver onboarding',async()=>{
 for(const name of ['MessagesView','TransactionsView']){
  let i=0;const View=await component(name,name==='MessagesView'?'// Shared driveway frame':'function HostDashboard(',{
   React,C,FindParkingLink:Link,useEffect:()=>{},useState:initial=>[i++===1?false:initial,()=>{}],
   useTransactions:()=>({data:{spent:[],earned:[],payouts:[]},loading:false,error:''}),
  });
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(View,{user:{role:'host'}})),/href="\/parking"/);
 }
});
test('both desktop auth controls retain branded styles at 761, 790 and 819 pixels',()=>{
 for(const width of [761,790,819]){
  const styles={};css.walkRules(rule=>{
   let parent=rule.parent;while(parent){if(parent.type==='atrule'&&parent.name==='media'){
    const min=parent.params.match(/min-width:\s*(\d+)px/),max=parent.params.match(/max-width:\s*(\d+)px/);
    if(min&&width<+min[1]||max&&width>+max[1])return;
   }parent=parent.parent;}
   if(['.ps-desktop-auth-actions button','.ps-desktop-signin','.ps-desktop-join'].includes(rule.selector)){
    styles[rule.selector]||={};rule.walkDecls(d=>styles[rule.selector][d.prop]=d.value);
   }
  });
  assert.equal(styles['.ps-desktop-signin'].color,'#fff');
  assert.equal(styles['.ps-desktop-join'].background,'#FFC107');
  assert.equal(styles['.ps-desktop-auth-actions button']['min-height'],'40px');
 }
});
