import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {futureBookingDate,localCalendarDate} from '../src/lib/bookingCalendarDate.js';
import {resolveLocalBookingStart} from '../api/_booking-local-time.js';
import {formatBookingEmailTimes} from '../api/_booking-email-times.js';
import {getSessionWindow} from '../api/_booking-rules.js';
import {fetchPublicParkingPage} from '../src/lib/publicParkingPage.js';
const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
test('tomorrow default is future in the property calendar across device zones and DST boundaries',()=>{
 for(const timeZone of ['America/Toronto','Europe/Bucharest','Pacific/Kiritimati','Pacific/Honolulu']){
  for(const now of ['2026-10-19T23:55:00Z','2026-03-07T23:55:00Z','2026-10-31T23:55:00Z']){
   const date=futureBookingDate(timeZone,new Date(now));
   assert.ok(resolveLocalBookingStart({bookingDate:localCalendarDate(date),startHour:9,timeZone})>new Date(now));
  }
 }
 for(const zone of ['Europe/Bucharest','America/Los_Angeles','Pacific/Auckland']){
  const out=execFileSync(process.execPath,['--input-type=module','-e',`import {futureBookingDate,localCalendarDate} from './src/lib/bookingCalendarDate.js';process.stdout.write(localCalendarDate(futureBookingDate('America/Toronto',new Date('2026-10-20T01:00Z'))));`],{env:{...process.env,TZ:zone},encoding:'utf8'});
  assert.equal(out,'2026-10-20');
 }
});
test('Toronto 9–11 schedule and Bucharest Book Now preserve the same instants on both dashboards and emails',()=>{
 const start=app.indexOf('function clientBookingWindow('),end=app.indexOf('async function requestBookingCancellation(',start);
 const display=new Function(app.slice(start,end)+';return {clientBookingWindow,clientBookingDisplay};')();
 const instant=resolveLocalBookingStart({bookingDate:'2026-10-20',startHour:9,timeZone:'America/Toronto'}).toISOString();
 for(const row of [
  {hours:2,booking_date:'2026-10-20',start_hour:9,scheduled_starts_at:instant,property_time_zone:'America/Toronto',paid_at:'2026-10-19T10:00Z'},
  {hours:1,booking_date:null,start_hour:null,property_time_zone:'Europe/Bucharest',paid_at:'2026-10-19T12:01:00Z'},
 ]){
  const server=getSessionWindow(row),client=display.clientBookingWindow(row);
  assert.equal(client.start.toISOString(),server.start.toISOString());assert.equal(client.end.toISOString(),server.end.toISOString());
  const email=formatBookingEmailTimes(server.start,server.end,server.start,row.property_time_zone);
  const labels=display.clientBookingDisplay(client.start,Boolean(row.booking_date),client.end,row.property_time_zone);
  assert.match(email.timeZoneLabel,new RegExp(row.property_time_zone));
  assert.equal(labels.startTime,email.startTimeStr);assert.equal(labels.endTime,email.endTimeStr);
  assert.match(email.startTimeStr,row.booking_date?/9:00\s*a\.?m/i:/3:01\s*p\.?m/i);
 }
});
test('availability renders the validation response instead of a generic outage message',()=>{
 const block=app.slice(app.indexOf('    fetch(`/api/listing-availability?'),app.indexOf('  const chosenSpotAvailable'));
 assert.match(block,/res.status >= 400 && res.status < 500/);assert.match(block,/data.error/);assert.match(app,/availabilityFailed \|\| "Checking availability/);
});
const source=readFileSync(new URL('../api/public-parking.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');
import {publicDiscoveryListing} from '../src/lib/publicDiscovery.js';
const method=(req,res)=>req.method==='GET';
const response=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;},setHeader(){}});
test('public feed bounds pages and validates cursors before any database work',async()=>{
 let calls=0;const db={rpc:async(name,args)=>{calls++;assert.equal(name,'public_parking_page');assert.equal(args.p_before_id,null);return {data:Array.from({length:51},(_,i)=>({id:100-i,price:12,spaces:1,review_count:0,rating:0}))};}};
 const handler=new Function('supabaseAdmin','jsonMethod','publicDiscoveryListing',source)(db,method,publicDiscoveryListing);
 for(const cursor of ['-1','1 OR true','1.5',['1'],'9007199254740992']){const r=response();await handler({method:'GET',query:{cursor}},r);assert.equal(r.code,400);}assert.equal(calls,0);
 const r=response();await handler({method:'GET',query:{}},r);assert.equal(r.code,200);assert.equal(r.body.listings.length,50);assert.equal(r.body.nextCursor,'51');
});
test('repeated anonymous and authenticated refreshes use only the bounded public endpoint',async()=>{
 const requests=[];const fetcher=async(url,options)=>{requests.push({url,options});return Response.json({listings:[],nextCursor:null});};
 for(const accountState of ['anonymous','driver','host'])for(let n=0;n<5;n++)await fetchPublicParkingPage(null,undefined,fetcher);
 assert.equal(requests.length,15);assert.ok(requests.every(r=>r.url==='/api/public-parking'&&!r.options.headers));
 await fetchPublicParkingPage('51',undefined,fetcher);assert.equal(requests.at(-1).url,'/api/public-parking?cursor=51');
 await assert.rejects(()=>fetchPublicParkingPage('51',undefined,async()=>Response.json({listings:[],nextCursor:'51'})),/Unexpected/);
 await assert.rejects(()=>fetchPublicParkingPage(null,undefined,async()=>new Response('',{status:503})),/unavailable/);
});
