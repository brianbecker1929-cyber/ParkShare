import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {messageConversationKey} from '../src/lib/messageConversation.js';

const source=await readFile(process.env.QA_INBOX_ACCESS_SOURCE||new URL('../src/App.jsx',import.meta.url),'utf8');
const start=source.indexOf('function MessagesView('),end=source.indexOf('// Shared driveway frame',start);
const compiled=(await transform(source.slice(start,end),{loader:'jsx'})).code;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const thread=(overrides={})=>{const row={listingId:7,bookingId:42,participantId:'driver-A',title:'Synthetic driveway',otherParty:'Driver A',preview:'Synthetic preview',...overrides};return {...row,id:`${row.listingId}-${row.bookingId||'listing'}-${row.participantId}`};};
function nodes(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);React.Children.forEach(node.props?.children,child=>nodes(child,predicate,out));return out;}
function spokenText(node){if(typeof node==='string'||typeof node==='number')return String(node);if(!node||node.props?.['aria-hidden']==='true')return '';return React.Children.toArray(node.props?.children).map(spokenText).join(' ');}
async function inbox(records,{owner='host',role='host'}={}){
 const state=[],effects=[],opened=[],requests=[];let cursor=0,mounted=false;
 const values={React,C:{white:'#fff',navy:'#0E1B2E',concrete:'#ddd',muted:'#666',red:'#c00'},messageConversationKey,FindParkingLink:()=>React.createElement('a',{href:'/parking'},'Find parking'),
  useState:initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return [state[index],value=>{state[index]=typeof value==='function'?value(state[index]):value;}];},useEffect:fn=>{if(!mounted)effects.push(fn);},
  supabase:{auth:{getSession:async()=>({data:{session:{access_token:'synthetic-'+owner,user:{id:owner}}},error:null})}},
  fetch:async(url,init)=>{assert.equal(url,'/api/messages');assert.equal(init.headers.Authorization,'Bearer synthetic-'+owner);assert.equal(init.cache,'no-store');requests.push({url,...init});return Response.json({conversations:records});}};
 const View=new Function(...Object.keys(values),compiled+';return MessagesView;')(...Object.values(values));
 const render=()=>{cursor=0;return View({user:{id:owner,role},onOpenThread:value=>opened.push(value)});};
 render();mounted=true;const cleanups=effects.splice(0).map(fn=>fn());await tick();
 return {render,opened,requests,rows:()=>nodes(render(),node=>typeof node.props?.onClick==='function'),stop:()=>cleanups.forEach(fn=>fn?.())};
}

test('loaded conversation rows expose native keyboard controls with their visible accessible names',async()=>{
 const h=await inbox([thread({otherParty:'Driver <A>',title:'Driveway & parking',preview:'Where should I park?'})]);
 const [row]=h.rows();assert.equal(row.type,'button');assert.equal(row.props.type,'button');assert.notEqual(row.props.disabled,true);assert.notEqual(row.props.tabIndex,-1);assert.equal(row.props.onKeyDown,undefined,'native Enter/Space behavior needs no duplicate key handler');
 const name=spokenText(row);assert.match(name,/Driver <A>/);assert.match(name,/Driveway & parking/);assert.match(name,/Where should I park\?/);assert.doesNotMatch(name,/🧑|›/);
 assert.equal(nodes(row,node=>node!==row&&['button','a','input','div'].includes(node.type)).length,0,'button content stays valid phrasing content without nested controls');
 const html=renderToStaticMarkup(h.render());assert.match(html,/<button type="button"/);assert.match(html,/Driver &lt;A&gt;/);assert.match(html,/Driveway &amp; parking/);assert.equal(row.props.style.width,'100%');assert.equal(row.props.style.textAlign,'left');assert.notEqual(row.props.style.outline,'none');h.stop();
});
test('Host inbox keeps different Drivers and repeat bookings on one driveway as distinct selectable conversations',async()=>{
 const records=[thread(),thread({id:'7-43-driver-B',bookingId:43,participantId:'driver-B',otherParty:'Driver B'}),thread({id:'7-44-driver-A',bookingId:44}),thread({id:'7-listing-driver-A',bookingId:null})],h=await inbox(records),rows=h.rows();
 assert.equal(rows.length,4);assert.equal(new Set(rows.map(row=>row.key)).size,4);
 for(const [index,row] of rows.entries()){row.props.onClick();const selected=h.opened.at(-1);assert.equal(selected.id,'db-7','listing ID remains valid for opening the thread');assert.equal(selected.bookingId,records[index].bookingId);assert.equal(selected.participantId,records[index].participantId);}
 assert.equal(h.opened.length,4);assert.equal(h.requests.length,1);assert.equal(h.requests[0].method,undefined,'opening the inbox does not send a message');h.stop();
});
test('conversation keys stay attached to their context across reordered rows and edited previews',async()=>{
 const records=[thread(),thread({bookingId:43,participantId:'driver-B'})],a=await inbox(records),b=await inbox([...records].reverse().map(row=>({...row,title:'Updated title',preview:'Updated preview'})));
 const snapshot=h=>new Map(h.rows().map(row=>{row.props.onClick();const selected=h.opened.at(-1);return [JSON.stringify([selected.bookingId,selected.participantId]),row.key];}));
 const first=snapshot(a),second=snapshot(b);assert.equal(new Set(first.values()).size,2);for(const [context,key] of first)assert.equal(second.get(context),key);a.stop();b.stop();
});
test('Driver listing-only and booked threads remain distinct, with row identity scoped to the signed-in account',async()=>{
 const records=[thread({bookingId:null,participantId:'host',otherParty:'Host'}),thread({bookingId:42,participantId:'host',otherParty:'Host'})],a=await inbox(records,{owner:'driver-A',role:'driver'}),b=await inbox(records,{owner:'driver-B',role:'driver'});
 const keys=a.rows().map(row=>row.key);assert.equal(new Set(keys).size,2);assert.ok(b.rows().every((row,index)=>row.key!==keys[index]));for(const row of a.rows())row.props.onClick();assert.deepEqual(a.opened.map(row=>row.bookingId),[null,42]);assert.ok(a.opened.every(row=>row.participantId==='host'));a.stop();b.stop();
});
