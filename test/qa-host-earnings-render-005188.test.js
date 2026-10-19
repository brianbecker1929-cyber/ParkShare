import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {before,test} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {hostTransactionPresentation,hostEarnedTotal,hostEarningsContribution} from '../src/lib/hostTransactions.js';
let factory,source;
before(async()=>{
  source=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function TransactionsView('),source.indexOf('function HostDashboard('));
  const compiled=await transform(code,{loader:'jsx',jsx:'transform'});
  factory=new Function('React','useState','useTransactions','C','money','Badge','transactionStatusLabel',
    'hostTransactionPresentation','hostEarnedTotal','hostEarningsContribution',compiled.code+';return TransactionsView;');
});
function render({section='earned',earned=[],payoutsUnavailable=false}){
  const View=factory(React,()=>[section,()=>{}],()=>({data:{spent:[],earned,payouts:[],payoutsUnavailable},loading:false,error:''}),
    {navy:'#000',white:'#fff',concrete:'#ddd',moss:'green',muted:'#777',amber:'orange'},
    amount=>'$'+Number(amount).toFixed(2),({children})=>React.createElement('span',null,children),
    status=>({label:status,color:'#000'}),hostTransactionPresentation,hostEarnedTotal,hostEarningsContribution);
  return renderToStaticMarkup(React.createElement(View,{user:{id:'fixture'}}));
}
const partial={id:'booking-1',type:'booking',description:'Synthetic booking',date:'2026-10-19T12:00:00Z',status:'partially_refunded',
  earningsStatus:'partially_refunded',earningsState:'verified',gross:115,refundedAmount:23,platformFee:12,net:80};
test('earned transaction renders remaining amount, refund label and a correct before-fees breakdown',()=>{
  const html=render({earned:[partial]});
  for(const text of ['Partially refunded','$80.00','$115.00','$23.00','$12.00','before Stripe processing fees'])assert.ok(html.includes(text),text);
  assert.equal(html.includes('$100.00'),false);
});
test('unknown transaction renders review rather than zero or original full earnings',()=>{
  const html=render({earned:[{...partial,earningsState:'needs_review',earningsStatus:'review',net:null}]});
  assert.ok(html.includes('Under review'));assert.ok(html.includes('excluded from earnings totals'));
  assert.equal(html.includes('$0.00'),false);assert.equal(html.includes('$115.00'),false);
});
test('retained fee after full refund renders a negative remaining amount',()=>{
  const html=render({earned:[{...partial,earningsStatus:'refunded',refundedAmount:115,platformFee:15,net:-15}]});
  assert.ok(html.includes('$-15.00'));assert.ok(html.includes('Refunded'));
});
test('unavailable payout history has an explicit state instead of no-payouts copy',()=>{
  const html=render({section:'payouts',payoutsUnavailable:true});
  assert.ok(html.includes('Payout history is temporarily unavailable'));
  assert.equal(html.includes('No payouts yet'),false);
});
test('Host monthly/all-time summaries use the same signed remaining-earnings helper',()=>{
  const host=source.slice(source.indexOf('function HostDashboard('),source.indexOf('function MessagesView('));
  assert.match(host,/const thisMonthEarned = hostEarnedTotal\(txData\.earned\.filter/);
  assert.match(host,/const allTimeEarned = hostEarnedTotal\(txData\.earned\)/);
  assert.match(host,/Known all time/);assert.match(host,/Totals include verified amounts only/);
  assert.doesNotMatch(host,/paidEarned\.filter/);
});
