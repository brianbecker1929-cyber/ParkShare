import {CANCELLATION_REASONS} from '../src/lib/cancellationReasons.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {cancellationDeadlineError} from '../src/lib/bookingTime.js';
import {evaluateCancellation,DRIVER_CANCELLATION_NOTICE_MS} from '../api/_cancellation-policy.js';

const source=await readFile(process.env.QA_CANCELLATION_CONTEXT_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const begin=source.indexOf('function CancellationModal(');
const code=source.slice(begin,source.indexOf('function MyBookingsView(',begin));
const compiled=await transform(code,{loader:'jsx'});
const nodes=node=>!React.isValidElement(node)?[]:[node,...React.Children.toArray(node.props.children).flatMap(nodes)];
function modal({deadline=1000,busy=false,actor='driver',error='',reasonCode}={}){
  let now=999;
  let stateSlot=0;
  const values={React,CANCELLATION_REASONS,useEffect:()=>{},useState:initial=>[(stateSlot++%2===0?(reasonCode??(actor==='host'?'host_unavailable':'driver_plans')):'') ,()=>{}],C:{navy:'#000',muted:'#777',red:'#c00'},Modal:({children})=>React.createElement('section',null,children),
    Btn:({children,onClick,disabled})=>React.createElement('button',{type:'button',onClick,disabled},children),
    cancellationDeadlineError:value=>cancellationDeadlineError(value,now)};
  const View=new Function(...Object.keys(values),compiled.code+';return CancellationModal;')(...Object.values(values));
  const props={title:'Cancel fixture booking?',actor,busy,error,cancellationDeadline:deadline,onClose:()=>{},onConfirm:()=>{}};
  const tree=()=>{stateSlot=0;return View(props);};
  return {setTime:value=>{now=value;},html:()=>renderToStaticMarkup(tree()),button:label=>nodes(tree()).find(n=>n.props.children===label)};
}

test('Driver deadline matches the server policy immediately before, at and after the one-hour cutoff',()=>{
  const start=Date.parse('2026-10-23T15:00Z'),deadline=start-DRIVER_CANCELLATION_NOTICE_MS;
  const booking={renter_id:'driver',status:'confirmed',hours:1,booking_date:'2026-10-23',start_hour:11,scheduled_starts_at:new Date(start).toISOString(),paid_at:'2026-10-22T10:00Z'};
  for(const offset of [-1,0,1]){const now=deadline+offset;const server=evaluateCancellation({booking,userId:'driver',hostId:'host',now:new Date(now)});assert.equal(!cancellationDeadlineError(deadline,now),server.allowed,'offset '+offset);}
});
test('Host deadline matches server policy inside the Driver cutoff and strictly before the start',()=>{
  const start=Date.parse('2026-10-23T15:00Z'),deadline=start-1;
  const booking={renter_id:'driver',status:'confirmed',hours:1,booking_date:'2026-10-23',start_hour:11,scheduled_starts_at:new Date(start).toISOString(),paid_at:'2026-10-22T10:00Z'};
  for(const offset of [-30*60000,-1,0,1]){const now=start+offset;const server=evaluateCancellation({booking,userId:'host',hostId:'host',now:new Date(now)});assert.equal(!cancellationDeadlineError(deadline,now),server.allowed,'offset '+offset);}
});
test('supplied invalid deadlines or invalid clocks fail closed while optional deadlines stay optional',()=>{
  assert.equal(cancellationDeadlineError(undefined,1001),'');
  for(const deadline of [null,NaN,Infinity,'1000'])assert.match(cancellationDeadlineError(deadline,999),/Contact support/);
  assert.match(cancellationDeadlineError(1000,NaN),/Contact support/);
});
test('an open Driver dialog stops promising a refund and disables confirmation after the cutoff',()=>{
  const h=modal();h.setTime(1000);assert.equal(h.button('Confirm cancellation').props.disabled,false);assert.match(h.html(),/full refund/);
  h.setTime(1001);assert.equal(h.button('Confirm cancellation').props.disabled,true);assert.equal(h.button('Keep booking').props.disabled,false);assert.match(h.html(),/role="alert"/);assert.match(h.html(),/Contact support/);assert.doesNotMatch(h.html(),/full refund|5–10 business days/);
});
test('an open Host dialog expires at the start while allowing cancellation just before it',()=>{
  const h=modal({actor:'host',deadline:999});h.setTime(999);assert.equal(h.button('Confirm cancellation').props.disabled,false);assert.match(h.html(),/Driver will receive a full refund/);
  h.setTime(1000);assert.equal(h.button('Confirm cancellation').props.disabled,true);assert.equal(h.button('Keep booking').props.disabled,false);assert.match(h.html(),/Host cancellations must be requested before the booking starts/);assert.doesNotMatch(h.html(),/full refund|5–10 business days/);
});
test('a previously sent cancellation stays pending rather than reporting expiry while its response is unknown',()=>{
  const h=modal({busy:true});h.setTime(1001);assert.equal(h.button('Submitting…').props.disabled,true);assert.equal(h.button('Keep booking').props.disabled,true);assert.match(h.html(),/role="status"/);assert.match(h.html(),/Please wait for confirmation/);assert.doesNotMatch(h.html(),/Contact support|full refund|5–10 business days/);
});
test('Host confirmation without a Driver deadline preserves the original refund guidance',()=>{
  let slot=0;
  const values={React,CANCELLATION_REASONS,useEffect:()=>{},useState:()=>[slot++===0?'host_unavailable':'',()=>{}],C:{navy:'#000',muted:'#777',red:'#c00'},Modal:({children})=>React.createElement('section',null,children),Btn:({children})=>React.createElement('button',null,children),cancellationDeadlineError};
  const View=new Function(...Object.keys(values),compiled.code+';return CancellationModal;')(...Object.values(values));
  const html=renderToStaticMarkup(View({actor:'host',busy:false,onClose:()=>{},onConfirm:()=>{}}));assert.match(html,/Driver will receive a full refund/);assert.doesNotMatch(html,/Contact support/);
});

function liveModal({deadline=1000,busy=false,actor='driver'}={}) {
  let now=900, cursor=0, dirty=false, result, nextTimer=0;
  const slots=[], effects=[], timers=new Map(), listeners=new Map();
  const listen=(kind,fn)=>listeners.set(kind,fn), unlisten=kind=>listeners.delete(kind);
  const values={React,CANCELLATION_REASONS,C:{navy:'#000',muted:'#777',red:'#c00'},
    Date:{now:()=>now},cancellationDeadlineError:(value)=>cancellationDeadlineError(value,now),
    Modal:({children})=>React.createElement('section',null,children),Btn:({children,disabled})=>React.createElement('button',{disabled},children),
    window:{setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,at:now+delay});return nextTimer;},clearTimeout:id=>timers.delete(id),addEventListener:listen,removeEventListener:unlisten},
    document:{addEventListener:listen,removeEventListener:unlisten},
    useState:initial=>{const n=cursor++;slots[n]??={value:n===0?(actor==='host'?'host_unavailable':'driver_plans'):initial};return [slots[n].value,v=>{slots[n].value=typeof v==='function'?v(slots[n].value):v;dirty=true;}];},
    useEffect:(fn,deps)=>{const n=cursor++,prev=slots[n];if(!prev||deps.some((v,i)=>v!==prev.deps[i])){slots[n]={deps,cleanup:prev?.cleanup};effects.push(()=>{slots[n].cleanup?.();slots[n].cleanup=fn();});}}
  };
  const View=new Function(...Object.keys(values),compiled.code+';return CancellationModal;')(...Object.values(values));
  const props={actor,busy,cancellationDeadline:deadline};
  const render=()=>{do{dirty=false;cursor=0;result=View(props);for(const effect of effects.splice(0))effect();}while(dirty);};
  render();
  return {html:()=>renderToStaticMarkup(result),timers,listeners,
    jump:at=>{now=at;},
    advance:at=>{now=at;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}if(dirty)render();},
    focus:()=>{listeners.get('focus')?.();if(dirty)render();},
    update:changes=>{Object.assign(props,changes);render();},
    stop:()=>{for(const slot of slots)slot?.cleanup?.();}
  };
}

test('BUG-005677 an idle open dialog expires at deadline + 1ms without waiting for a parent tick',()=>{
  const h=liveModal();
  try {
    h.advance(1000);assert.match(h.html(),/full refund/);assert.doesNotMatch(h.html(),/disabled="">Confirm cancellation/);
    h.advance(1001);assert.doesNotMatch(h.html(),/full refund|5–10 business days/);
    assert.match(h.html(),/Driver cancellations need at least one hour of notice for an automatic refund/);
    assert.match(h.html(),/disabled="">Confirm cancellation/);
  } finally {h.stop();}
  assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
});

test('BUG-005677 long deadlines are rescheduled and returning focus refreshes expiry',()=>{
  const h=liveModal({deadline:2147485000});
  try {
    assert.equal([...h.timers.values()][0].at,900+2147483647);
    h.advance(900+2147483647);assert.equal(h.timers.size,1);assert.match(h.html(),/full refund/);
    h.advance(2147485001);h.focus();assert.doesNotMatch(h.html(),/full refund/);
  } finally {h.stop();}
});

test('BUG-005677 a throttled background tab removes refund copy on focus and clears its old timer',()=>{
  const h=liveModal();
  try {
    h.jump(1100);assert.match(h.html(),/full refund/);
    h.focus();assert.doesNotMatch(h.html(),/full refund/);assert.equal(h.timers.size,0);
  } finally {h.stop();}
});

test('BUG-005677 pending cancellations suspend expiry copy and cleanup timers',()=>{
  const h=liveModal();
  try {
    h.update({busy:true});assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
    h.advance(1001);assert.match(h.html(),/Please wait for confirmation/);assert.doesNotMatch(h.html(),/full refund|automatic refund/);
    h.update({busy:false});assert.match(h.html(),/Driver cancellations need at least one hour/);
  } finally {h.stop();}
});

test('access report excludes card-refund timing and keeps the support-review action',()=>{
  const h=modal({reasonCode:'driver_access'});
  assert.match(h.html(),/support for review|support request/);
  assert.match(h.html(),/booking remains active/);
  assert.equal(h.button('Request support review').props.disabled,false);
  assert.doesNotMatch(h.html(),/Stripe usually returns|5–10 business days|you.ll receive a full refund/);
});

test('ordinary Driver and Host cancellation dialogs retain card-refund timing',()=>{
  for(const actor of ['driver','host'])assert.match(modal({actor}).html(),/Stripe usually returns card refunds within 5–10 business days/);
});
