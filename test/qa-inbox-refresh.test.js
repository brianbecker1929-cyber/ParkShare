import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {messageConversationKey} from '../src/lib/messageConversation.js';

const source=await readFile(process.env.QA_MESSAGE_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const begin=source.indexOf('function MessagesView(');
const whole=source.slice(begin,source.indexOf('// Shared driveway frame',begin));
const compiled=await transform(whole,{loader:'jsx'});
const panelStart=source.indexOf('function MessagingPanel(');
const compiledPanel=await transform(source.slice(panelStart,source.indexOf('// ─── Payment Flow',panelStart)),{loader:'jsx'});
const names=[...whole.matchAll(/const \[(\w+), \w+\] = useState/g)].map(m=>m[1]);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const later=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const session=id=>({data:{session:{access_token:id+'-token',user:{id}}}});
const conversation=(party='Driver A',bookingId=42)=>({listingId:7,bookingId,participantId:party,title:'Fixture driveway',otherParty:party,preview:party+' PRIVATE PREVIEW'});
const success=conversations=>Response.json({conversations});
const nodes=tree=>!React.isValidElement(tree)?[]:[tree,...React.Children.toArray(tree.props.children).flatMap(nodes)];
const text=node=>!React.isValidElement(node)?String(node??''):React.Children.toArray(node.props.children).map(text).join('');
function harness({fetcher=async()=>success([]),auth=async()=>session('A')}={}){
  const state={},effects=[],requests=[],opened=[],writes=[];let cursor=0,tree,previous,cleanup;
  const values={React,messageConversationKey,C:new Proxy({},{get:()=>'#000'}),FindParkingLink:()=>React.createElement('a',null,'Find parking'),
    useState:initial=>{const key=names[cursor++];if(!(key in state))state[key]=typeof initial==='function'?initial():initial;return [state[key],v=>{writes.push(key);state[key]=typeof v==='function'?v(state[key]):v;}];},
    useEffect:(fn,deps)=>effects.push({fn,deps}),supabase:{auth:{getSession:auth}},fetch:(url,init)=>{requests.push({url,...init});return fetcher(url,init);},
  };
  const View=new Function(...Object.keys(values),compiled.code+';return MessagesView;')(...Object.values(values));
  function render(){cursor=0;effects.length=0;tree=View({user:{id:'A',role:'host'},onOpenThread:value=>opened.push(value)});return tree;}
  function commit(){render();const effect=effects[0];if(!previous||effect.deps.some((v,i)=>!Object.is(v,previous[i]))){cleanup?.();previous=effect.deps;cleanup=effect.fn();}render();}
  function button(label){return nodes(tree).find(n=>n.type==='button'&&text(n)===label);}
  return {state,requests,opened,writes,render,commit,button,html:()=>renderToStaticMarkup(tree),
    click(label){const b=button(label);assert.ok(b,'Missing button: '+label);assert.ok(!b.props.disabled);b.props.onClick();commit();},
    rows:()=>nodes(tree).filter(n=>n.props.className==='ps-conversation-row'),stop(){cleanup?.();}};
}

test('failed inbox can retry an authenticated read without leaving Messages',async()=>{
  let count=0;const h=harness({fetcher:async()=>++count===1?Response.json({error:'Conversations unavailable'},{status:503}):success([conversation()])});h.commit();await tick();h.render();assert.match(h.html(),/role="alert"/);assert.doesNotMatch(h.html(),/No conversations yet/);
  h.click('Retry conversations');assert.ok(h.button('Loading inbox…').props.disabled);assert.match(h.html(),/role="status"/);assert.doesNotMatch(h.html(),/Conversations unavailable|No conversations yet/);
  await tick();h.render();assert.match(h.html(),/Driver A PRIVATE PREVIEW/);assert.ok(h.button('Refresh conversations'));assert.equal(h.requests.length,2);
  for(const r of h.requests){assert.equal(r.url,'/api/messages');assert.equal(r.method,undefined);assert.equal(r.cache,'no-store');assert.equal(r.headers.Authorization,'Bearer A-token');}assert.equal(h.requests[0].signal.aborted,true);h.stop();
});
test('Refresh conversations retrieves an incoming conversation while staying in the inbox',async()=>{
  let count=0;const h=harness({fetcher:async()=>success(++count===1?[conversation()]:[conversation(),conversation('Driver B',43)])});h.commit();await tick();h.render();assert.equal(h.rows().length,1);
  h.click('Refresh conversations');assert.equal(h.rows().length,0);await tick();h.render();assert.equal(h.rows().length,2);assert.match(h.html(),/Driver B PRIVATE PREVIEW/);h.stop();
});
test('refreshed same-listing rows retain distinct identities and open the selected booking and participant',async()=>{
  const h=harness({fetcher:async()=>success([conversation(),conversation('Driver B',43)])});h.commit();await tick();h.render();h.click('Refresh conversations');await tick();h.render();const rows=h.rows();assert.notEqual(rows[0].key,rows[1].key);rows[1].props.onClick();assert.equal(h.opened[0].bookingId,43);assert.equal(h.opened[0].participantId,'Driver B');assert.equal(h.opened[0].id,'db-7');h.stop();
});
test('BUG-005480 inbox selection preserves the role and the actual chat header renders it',async()=>{
  for(const partyRole of ['Driver','Host']) {
    const h=harness({fetcher:async()=>success([{...conversation('Synthetic participant'),partyRole}])});
    try{
      h.commit();await tick();h.render();h.rows()[0].props.onClick();
      const listing=h.opened[0];assert.equal(listing.partyRole,partyRole);
      const values={React,C:{},INITIAL_THREADS:{},messageConversationKey,
        useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect:()=>{}};
      const Panel=new Function(...Object.keys(values),compiledPanel.code+';return MessagingPanel;')(...Object.values(values));
      const html=renderToStaticMarkup(Panel({listing,user:{id:'A'},onClose:()=>{}}));
      assert.match(html,new RegExp(partyRole+' · Fixture driveway'));
      assert.doesNotMatch(html,new RegExp((partyRole==='Driver'?'Host':'Driver')+' · Fixture driveway'));
      assert.match(html,/Synthetic participant/);
    }finally{h.stop();}
  }
});
test('repeated failures stay retryable and a successful empty response is not an error',async()=>{
  let count=0;const h=harness({fetcher:async()=>++count<3?Response.json({},{status:503}):success([])});h.commit();await tick();h.render();h.click('Retry conversations');await tick();h.render();assert.ok(h.button('Retry conversations'));h.click('Retry conversations');await tick();h.render();assert.match(h.html(),/No conversations yet/);assert.doesNotMatch(h.html(),/role="alert"/);assert.ok(h.button('Refresh conversations'));assert.equal(h.requests.length,3);h.stop();
});
test('a refresh failure retires private previews rather than displaying stale conversations',async()=>{
  let count=0;const h=harness({fetcher:async()=>++count===1?success([conversation()]):Response.json({},{status:503})});h.commit();await tick();h.render();assert.match(h.html(),/PRIVATE PREVIEW/);h.click('Refresh conversations');await tick();h.render();assert.doesNotMatch(h.html(),/PRIVATE PREVIEW|No conversations yet/);assert.ok(h.button('Retry conversations'));h.stop();
});
test('retry checks the current session owner before any new inbox read',async()=>{
  let owner='A';const h=harness({auth:async()=>session(owner),fetcher:async()=>Response.json({},{status:503})});h.commit();await tick();h.render();owner='B';h.click('Retry conversations');await tick();h.render();assert.equal(h.requests.length,1);assert.match(h.html(),/Please sign in again/);assert.deepEqual(h.state.dbConvos,[]);h.stop();
});
test('closing Messages aborts a pending retry and ignores its late private body or error',async()=>{
  for(const fails of [false,true]){const pending=later();let count=0;const h=harness({fetcher:async()=>++count===1?Response.json({},{status:503}):pending.promise});h.commit();await tick();h.render();h.click('Retry conversations');await tick();h.stop();const writes=h.writes.length;if(fails)pending.reject(Error('LATE PRIVATE ERROR'));else pending.resolve(success([conversation()]));await tick();assert.equal(h.writes.length,writes);assert.equal(h.requests[1].signal.aborted,true);}
});
test('inbox refresh is an accessible native action unavailable during its pending read',async()=>{
  const pending=later();const h=harness({fetcher:()=>pending.promise});h.commit();const b=h.button('Loading inbox…');assert.ok(b);assert.equal(b.props.type,'button');assert.ok(b.props.disabled);assert.ok(b.props.style.minHeight>=44);pending.resolve(success([]));await tick();h.render();assert.equal(h.button('Refresh conversations').props.disabled,false);h.stop();
});

