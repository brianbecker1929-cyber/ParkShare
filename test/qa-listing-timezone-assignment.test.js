import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveListingTimeZone} from '../api/_listing-time-zone.js';
import {hostListingRow} from '../api/_host-listing.js';
import {listingPublicationIdentity} from '../api/_listing-publication.js';
import {hasListingCoordinates,changeListingAddress} from '../src/lib/listingLocation.js';
import {publishHostListing,requestPropertyTimeZone} from '../src/lib/hostListingPublish.js';
import {createAvailabilityPreset} from '../src/lib/listingAvailability.js';
import {resolveLocalBookingStart} from '../api/_booking-local-time.js';
import {formatBookingEmailTimes} from '../api/_booking-email-times.js';
const HOST='00000000-0000-4000-8000-000000000081',PROJECT_URL='https://sample.invalid';
const payload=()=>({requestId:'10000000-0000-4000-8000-000000000011',title:'Synthetic driveway',address:'123 Test Street, Toronto ON M5V 2T6',price:12,description:'Synthetic only',features:['Covered'],
  photos:[PROJECT_URL+'/storage/v1/object/public/listing-photos/'+HOST+'/10000000-0000-4000-8000-000000000001.webp'],lat:43.65,lng:-79.38,spots:[{forRent:true}],availability:createAvailabilityPreset('anytime','Pacific/Auckland')});
const client={auth:{getSession:async()=>({data:{session:{access_token:'synthetic'}}})}};
test('server geographic lookup returns Toronto and Bucharest and supports land on zero meridians',()=>{
 for(const [point,zone] of [[{lat:43.65,lng:-79.38},'America/Toronto'],[{lat:46.77,lng:23.59},'Europe/Bucharest'],[{lat:5.6,lng:0},'Africa/Accra']])assert.equal(resolveListingTimeZone(point),zone);
 assert.equal(hasListingCoordinates({lat:0,lng:20}),true);
});
test('missing, malformed, ambiguous, invalid and offshore coordinates never default to Toronto',()=>{
 for(const p of [{},{lat:null,lng:null},{lat:'43.65',lng:-79.38},{lat:NaN,lng:1},{lat:91,lng:1},{lat:1,lng:-181},{lat:0,lng:0}])assert.throws(()=>resolveListingTimeZone(p),RangeError);
 for(const zones of [[],['America/Toronto','America/New_York'],['Etc/GMT'],['Bad/Zone'],[null]])assert.throws(()=>resolveListingTimeZone({lat:43,lng:-79},()=>zones),RangeError);
});
test('street, city, region and postal edits invalidate old coordinates and satellite geometry',()=>{
 const original={street:'Old St',city:'Toronto',region:'ON',postal:'M5V 2T6',lat:43.65,lng:-79.38,spots:[{bounds:{north:44},forRent:true}]};
 for(const key of ['street','city','region','postal']){const next=changeListingAddress(original,key,'new');assert.equal(next.lat,null);assert.equal(next.lng,null);assert.deepEqual(next.spots,[]);assert.equal(original.lat,43.65);}
 assert.equal(changeListingAddress(original,'city','Toronto'),original);
 assert.equal(changeListingAddress(original,'postal','m5v2t6').lat,43.65);
});
test('server owns Host identity, zone, capacity, photos and property-local availability',()=>{
 const body={...payload(),host_id:'attacker',time_zone:'Pacific/Auckland',spaces:99,img:'https://evil.invalid/image.png'};
 const row=hostListingRow(body,HOST,'America/Toronto',PROJECT_URL,new Date('2026-10-19T12:00Z'));
 assert.equal(row.host_id,HOST);assert.equal(row.time_zone,'America/Toronto');assert.equal(row.spaces,1);assert.equal(row.availability.timezone,'America/Toronto');assert.equal(row.img,body.photos[0]);
 assert.deepEqual(Object.keys(row.spots[0]).sort(),['bounds','forRent','id']);
 const start=resolveLocalBookingStart({bookingDate:'2026-10-20',startHour:9,timeZone:row.time_zone});
 assert.equal(start.toISOString(),'2026-10-20T13:00:00.000Z');assert.match(formatBookingEmailTimes(start,new Date(+start+7200000),start,row.time_zone).startTimeStr,/9:00/);
});
test('server validates price, photos, spot geometry, schedule and address before any insert',()=>{
 const baseline=payload();for(const overrides of [{price:0},{photos:['https://evil.invalid/x.webp']},{photos:[]},{address:'incomplete'},{spots:[]},{spots:[{forRent:false}]},{spots:[{forRent:true,bounds:{north:46,south:45,east:24,west:23}}]},{availability:{...baseline.availability,exceptions:[{type:'unavailable',startDate:'2020-01-01',endDate:'2020-01-02'}]}}])assert.throws(()=>hostListingRow({...baseline,...overrides},HOST,'America/Toronto',PROJECT_URL,new Date('2026-10-19')),RangeError);
});
const code=readFileSync(new URL('../api/host-listings.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default async function handler','return async function handler');
const response=()=>({status(n){this.code=n;return this;},json(body){this.body=body;return this;},setHeader(){}});
function route({role='host',anonymous=false,dbError=null}={}){
 const writes=[];let stored=null;const db={from(table){assert.equal(table,'profiles');return {select:()=>({eq:(key,id)=>{assert.equal(id,HOST);return {maybeSingle:async()=>({data:{role}})};}})};},
  async rpc(name,args){assert.equal(name,'publish_host_listing');if(stored)return {data:{...stored,replayed:true}};
   if(args.p_rejection){stored={rejected:true,error:args.p_rejection};return {data:stored};}
   if(!args.p_listing)return {data:null};writes.push(args.p_listing);if(dbError)return {error:dbError};stored={id:123,timeZone:args.p_listing.time_zone};return {data:{...stored,replayed:false}};}};
 const method=(req,res)=>{if(req.method==='POST')return true;res.status(405).json({});return false;};
 const handler=new Function('jsonMethod','requireUser','supabaseAdmin','resolveListingTimeZone','hostListingRow','listingPublicationIdentity','process',code)(method,async(req,res)=>{if(anonymous){res.status(401).json({});return null;}return {id:HOST,user_metadata:{role:'host'}};},db,resolveListingTimeZone,hostListingRow,listingPublicationIdentity,{env:{SUPABASE_URL:PROJECT_URL}});
 return {writes,async run(body,method='POST'){const res=response();await handler({method,body},res);return res;}};
}
test('anonymous, Driver and wrong-method requests never publish even with forged Host claims',async()=>{
 for(const opts of [{anonymous:true},{role:'driver'},{role:null}]){const r=route(opts),res=await r.run(payload());assert.equal(res.code,opts.anonymous?401:403);assert.equal(r.writes.length,0);}
 const r=route();assert.equal((await r.run(payload(),'GET')).code,405);assert.equal(r.writes.length,0);
});
test('Host preview performs no writes; publishing independently recomputes its zone',async()=>{
 const r=route();assert.deepEqual((await r.run({preview:true,lat:46.77,lng:23.59,time_zone:'America/Toronto'})).body,{timeZone:'Europe/Bucharest'});assert.equal(r.writes.length,0);
 const res=await r.run({...payload(),time_zone:'Asia/Tokyo'});assert.equal(res.code,201);assert.equal(r.writes[0].time_zone,'America/Toronto');
 const invalid=route();assert.equal((await invalid.run({...payload(),lat:null})).code,400);assert.equal(invalid.writes.length,0);
});
test('database insert failure is actionable and does not claim success',async()=>{
 const r=route({dbError:{code:'57014'}});const res=await r.run(payload());assert.equal(res.code,503);assert.match(res.body.error,/Check your Host Dashboard/);
});
test('frontend publishes only with an authenticated bearer token and handles uncertain outcomes without photo deletion',async()=>{
 let request;const listing=await publishHostListing(client,payload(),async(url,options)=>{request={url,options};return Response.json({listing:{id:123,timeZone:'America/Toronto'}},{status:201});});
 assert.equal(listing.id,123);assert.equal(request.url,'/api/host-listings');assert.equal(request.options.headers.Authorization,'Bearer synthetic');
 await assert.rejects(()=>publishHostListing(client,payload(),async()=>Response.json({error:'Select a pin',safeToDiscard:true},{status:400})),e=>e.cleanupAllowed===true);
 for(const failure of [async()=>{throw Error('response lost');},async()=>Response.json({error:'DB unavailable'},{status:503})])await assert.rejects(()=>publishHostListing(client,payload(),failure),e=>!e.cleanupAllowed&&/Check your Host Dashboard/.test(e.message));
 let called=false;await assert.rejects(()=>publishHostListing({auth:{getSession:async()=>({data:{session:null}})}},payload(),async()=>{called=true;}));assert.equal(called,false);
});
test('timezone preview submits only the current pin and no client zone claim',async()=>{
 let sent;const tz=await requestPropertyTimeZone(client,{lat:46.77,lng:23.59,timeZone:'Asia/Tokyo'},undefined,async(url,opts)=>{sent=JSON.parse(opts.body);return Response.json({timeZone:'Europe/Bucharest'});});
 assert.equal(tz,'Europe/Bucharest');assert.deepEqual(sent,{preview:true,lat:46.77,lng:23.59});
});

test('special-date validation uses the property calendar near midnight in a remote Host browser',()=>{
 const body=payload();body.availability.timezone='Pacific/Auckland';body.availability.exceptions=[{id:'special',type:'unavailable',startDate:'2026-10-19',endDate:'2026-10-19',windows:[]}];
 const now=new Date('2026-10-19T23:30:00Z');
 assert.equal(hostListingRow(body,HOST,'America/Toronto',PROJECT_URL,now).availability.timezone,'America/Toronto');
 assert.throws(()=>hostListingRow(body,HOST,'Europe/Bucharest',PROJECT_URL,now),RangeError);
});
