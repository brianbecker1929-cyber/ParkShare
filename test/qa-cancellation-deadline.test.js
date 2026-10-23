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
function modal({deadline=1000,busy=false,actor='driver',error=''}={}){
  let now=999;
  const values={React,C:{navy:'#000',muted:'#777',red:'#c00'},Modal:({children})=>React.createElement('section',null,children),
    Btn:({children,onClick,disabled})=>React.createElement('button',{type:'button',onClick,disabled},children),
    cancellationDeadlineError:value=>cancellationDeadlineError(value,now)};
  const View=new Function(...Object.keys(values),compiled.code+';return CancellationModal;')(...Object.values(values));
  const props={title:'Cancel fixture booking?',actor,busy,error,cancellationDeadline:deadline,onClose:()=>{},onConfirm:()=>{}};
  const tree=()=>View(props);
  return {setTime:value=>{now=value;},html:()=>renderToStaticMarkup(tree()),button:label=>nodes(tree()).find(n=>n.props.children===label)};
}

test('Driver deadline matches the server policy immediately before, at and after the one-hour cutoff',()=>{
  const start=Date.parse('2026-10-23T15:00Z'),deadline=start-DRIVER_CANCELLATION_NOTICE_MS;
  const booking={renter_id:'driver',status:'confirmed',hours:1,booking_date:'2026-10-23',start_hour:11,scheduled_starts_at:new Date(start).toISOString(),paid_at:'2026-10-22T10:00Z'};
  for(const offset of [-1,0,1]){const now=deadline+offset;const server=evaluateCancellation({booking,userId:'driver',hostId:'host',now:new Date(now)});assert.equal(!cancellationDeadlineError(deadline,now),server.allowed,'offset '+offset);}
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
test('a previously sent cancellation stays pending rather than reporting expiry while its response is unknown',()=>{
  const h=modal({busy:true});h.setTime(1001);assert.equal(h.button('Cancelling…').props.disabled,true);assert.equal(h.button('Keep booking').props.disabled,true);assert.match(h.html(),/role="status"/);assert.match(h.html(),/Please wait for confirmation/);assert.doesNotMatch(h.html(),/Contact support|full refund|5–10 business days/);
});
test('Host confirmation without a Driver deadline preserves the original refund guidance',()=>{
  const values={React,C:{navy:'#000',muted:'#777',red:'#c00'},Modal:({children})=>React.createElement('section',null,children),Btn:({children})=>React.createElement('button',null,children),cancellationDeadlineError};
  const View=new Function(...Object.keys(values),compiled.code+';return CancellationModal;')(...Object.values(values));
  const html=renderToStaticMarkup(View({actor:'host',busy:false,onClose:()=>{},onConfirm:()=>{}}));assert.match(html,/Driver will receive a full refund/);assert.doesNotMatch(html,/Contact support/);
});
