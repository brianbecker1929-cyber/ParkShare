import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {bookingDisplayTimeZone} from '../api/_booking-display-time-zone.js';
import {getSessionWindow} from '../api/_booking-rules.js';
import {transactionDateDetails} from '../src/lib/transactionDetails.js';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';

const source=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function clientBookingWindow('),source.indexOf('async function requestBookingCancellation('));
const {clientBookingWindow,clientBookingDisplay}=new Function(helpers+';return {clientBookingWindow,clientBookingDisplay};')();
const legacy={id:33,listing_id:25,hours:1,paid_at:'2026-10-19T18:06:55.806Z',scheduled_starts_at:null,booking_date:null,start_hour:null,property_time_zone:null};
test('PK-33 legacy scenario shows 2:06 PM Toronto consistently in both screens, independent of the travelling browser',()=>{
  const original=process.env.TZ;
  try{
    const results=['Europe/Bucharest','America/Vancouver','UTC'].map(zone=>{
      process.env.TZ=zone;
      const propertyTimeZone=bookingDisplayTimeZone(legacy,{time_zone:'America/Toronto'});
      const window=clientBookingWindow(legacy),server=getSessionWindow(legacy);
      assert.equal(window.start.toISOString(),server.start.toISOString());assert.equal(window.end.toISOString(),server.end.toISOString());
      const card=clientBookingDisplay(window.start,false,window.end,propertyTimeZone);
      const transaction=transactionDateDetails({type:'booking',date:legacy.paid_at,bookingStart:server.start.toISOString(),propertyTimeZone});
      assert.match(card.startTime,/2:06\s*p\.?m/i);assert.match(card.endTime,/3:06\s*p\.?m/i);
      assert.match(transaction.parking,/2:06\s*p\.?m/i);assert.match(transaction.paid,/2:06\s*p\.?m/i);
      assert.equal(card.timeZoneLabel,transaction.zone);assert.equal(card.timeZoneLabel,'America/Toronto local time');
      return {card,transaction};
    });
    assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
  }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});
test('stored snapshot wins over a changed listing; only valid zone metadata is used',()=>{
  assert.equal(bookingDisplayTimeZone({property_time_zone:'America/Vancouver'},{time_zone:'America/Toronto'}),'America/Vancouver');
  assert.equal(bookingDisplayTimeZone({property_time_zone:'invalid'},{time_zone:'America/Toronto'}),'America/Toronto');
  for(const value of [null,'','Bad/Zone',{},42])assert.equal(bookingDisplayTimeZone({property_time_zone:value},{time_zone:value}),null);
});
test('truly missing or invalid zones use the same explicitly labelled UTC fallback on both screens',()=>{
  const original=process.env.TZ;process.env.TZ='Europe/Bucharest';
  try{
    for(const propertyTimeZone of [null,'Bad/Zone']){
      const window=clientBookingWindow(legacy),card=clientBookingDisplay(window.start,false,window.end,propertyTimeZone);
      const transaction=transactionDateDetails({type:'booking',date:legacy.paid_at,bookingStart:window.start.toISOString(),propertyTimeZone});
      assert.match(card.startTime,/6:06\s*p\.?m/i);assert.equal(card.timeZoneLabel,'UTC (property time zone unavailable)');assert.equal(card.timeZoneLabel,transaction.zone);
    }
  }finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});

test('the real reservation schedule visibly labels its zone, including the active countdown layout',async()=>{
  const start=source.indexOf('function BookingSchedule('),end=source.indexOf('function EventDestinationSummary(',start);
  const compiled=await transform(source.slice(start,end),{loader:'jsx'});
  const Schedule=new Function('React','C','formatBookingTimeRemaining',compiled.code+';return BookingSchedule;')(React,{white:'#fff'},()=>'30 minutes');
  for(const isActive of [false,true]){
    const html=renderToStaticMarkup(React.createElement(Schedule,{date:'Oct 19, 2026',startTime:'2:06 p.m.',endTime:'3:06 p.m.',duration:'1 hr',isActive,timeZoneLabel:'America/Toronto local time'}));
    assert.match(html,/>America\/Toronto local time<\/div>/);assert.match(html,/grid-column:1 \/ -1/);
    assert.match(html,/aria-label="[^"]*America\/Toronto local time/);
    assert.equal(html.includes('role="timer"'),isActive);
  }
});
