import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {transactionDateDetails} from '../src/lib/transactionDetails.js';
import {hostTransactionPresentation,hostEarningsContribution} from '../src/lib/hostTransactions.js';

const row={type:'booking',id:'booking-313',bookingId:313,description:'Maple driveway',address:'',status:'refunded',amount:23,refundedAmount:23,spotLabel:'B',
  date:'2026-10-18T02:30:00Z',bookingStart:'2026-10-22T16:00:00Z',propertyTimeZone:'America/Toronto'};
const source=await readFile(process.env.QA_TRANSACTION_DETAILS_SOURCE_FILE||new URL('../src/App.jsx',import.meta.url),'utf8');
const component=source.slice(source.indexOf('function TransactionsView('),source.indexOf('function useHostListingDeletion('));
const compiled=await transform(component,{loader:'jsx'});
function render(rows=[row],{loading=false,error='',section='spent'}={}){
  const values={React,useTransactions:()=>({data:{spent:rows,earned:[],payouts:[]},loading,error}),useState:()=>[section,()=>{}],
    C:new Proxy({},{get:()=>'#000'}),transactionDateDetails,hostTransactionPresentation,hostEarningsContribution,
    transactionStatusLabel:status=>({label:status==='refunded'?'Refunded':status,color:'#000'}),money:v=>'$'+Number(v).toFixed(2),
    Badge:({children})=>React.createElement('span',null,children),FindParkingLink:()=>null};
  const View=new Function(...Object.keys(values),compiled.code+';return TransactionsView;')(...Object.values(values));
  return renderToStaticMarkup(React.createElement(View,{user:{id:'DRIVER',role:'driver'}}));
}
test('refund card identifies listing, booking, separate payment/parking dates, property zone and amount',()=>{
  const html=render();
  for(const value of ['Maple driveway','Booking #PK-313','Parking Oct 22, 2026','Paid Oct 17, 2026','America/Toronto local time','Spot B','Refunded','$23.00 CAD refunded'])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/Parking session|Invalid Date/);
});
test('travelling browsers show the same payment and parking day for a Toronto booking',()=>{
  const original=process.env.TZ;
  try {
    const results=['Europe/Athens','America/Vancouver','UTC'].map(zone=>{process.env.TZ=zone;return render();});
    assert.equal(results[0],results[1]);assert.equal(results[1],results[2]);
  }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});
test('Vancouver local dates survive a UTC midnight boundary',()=>{
  const details=transactionDateDetails({...row,propertyTimeZone:'America/Vancouver',bookingStart:'2026-10-22T02:00Z'});
  assert.match(details.parking,/Oct 21, 2026/);assert.match(details.paid,/Oct 17, 2026/);assert.equal(details.zone,'America/Vancouver local time');
});
test('DST uses the property offset for each instant independently',()=>{
  const details=transactionDateDetails({...row,date:'2026-11-01T05:30Z',bookingStart:'2026-11-01T06:30Z'});
  assert.match(details.paid,/1:30/);assert.match(details.parking,/1:30/);
});
test('missing/invalid zones use an explicitly labelled UTC fallback',()=>{
  for(const propertyTimeZone of [null,'Not/AZone']){
    const details=transactionDateDetails({...row,propertyTimeZone});assert.match(details.paid,/Oct 18, 2026/);assert.equal(details.zone,'UTC (property time zone unavailable)');
  }
});
test('unknown dates never show epoch or invalid dates',()=>{
  const html=render([{...row,date:null,bookingStart:'invalid',propertyTimeZone:null}]);
  assert.match(html,/Payment date unavailable/);assert.match(html,/Parking date unavailable/);assert.doesNotMatch(html,/Invalid Date|1970/);
});
test('extension shows its payment date without claiming it is a separate parking reservation',()=>{
  const html=render([{...row,type:'extension',description:'Maple driveway — added time'}]);
  assert.match(html,/Paid Oct 17, 2026/);assert.doesNotMatch(html,/Parking Oct|Parking date unavailable/);
});
test('listing titles remain escaped and loading/errors hide financial rows',()=>{
  const html=render([{...row,description:'<script>alert(1)</script>'}]);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  for(const state of [{loading:true},{error:'Unable to load transactions'}])assert.doesNotMatch(render([row],state),/Maple driveway|Booking #PK-313|Paid Oct/);
});
