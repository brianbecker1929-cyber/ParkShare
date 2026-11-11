import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {VEHICLE_TYPES,normaliseVehicleType} from '../src/lib/vehicleTypes.js';
import {VEHICLE_MAKES,VEHICLE_MODELS,VEHICLE_COLOURS} from '../src/lib/vehicleOptions.js';
import {getBookableVehicles,validateDriverProfile,normaliseDriverProfile} from '../src/lib/driverProfile.js';
import {validateBookingVehicle,bookingVehicleMetadata} from '../src/lib/bookingVehicle.js';
import {getVehicleBodyType} from '../src/lib/vehicleVisuals.js';
import {sendDriverBookingConfirmation} from '../api/_booking-confirmation-delivery.js';
import {getSessionWindow} from '../api/_booking-rules.js';
import {formatBookingEmailTimes} from '../api/_booking-email-times.js';
const app=await readFile(process.env.QA_BOOKING_FIELDS_APP || new URL('../src/App.jsx',import.meta.url),'utf8');
const vehicle={vehicleType:'sedan',vehicleMake:'Honda',vehicleModel:'Civic',vehicleColour:'Blue',licensePlate:'TYPE 157'};
const guest={id:'guest-friend',...vehicle,vehicleType:'hatchback'};
const fieldsCode=(await transform(app.slice(app.indexOf('function VehicleProfileFields('),app.indexOf('async function persistDriverProfile(')),{loader:'jsx'})).code;
const Fields=new Function('React','VEHICLE_TYPES','VEHICLE_MAKES','VEHICLE_MODELS','VEHICLE_COLOURS',fieldsCode+';return VehicleProfileFields;')(React,VEHICLE_TYPES,VEHICLE_MAKES,VEHICLE_MODELS,VEHICLE_COLOURS);
const nodes=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(nodes)];

test('BUG-005157 actual primary/guest/booking fields expose a labeled optional body-type selector',()=>{
  for(const prefix of ['driver-profile-primary','driver-profile-guest-0','booking-vehicle']) {
    const edits=[],props={vehicle,idPrefix:prefix,errors:{},onUpdate:(...args)=>edits.push(args),onMakeChange(){}};
    const tree=Fields(props),select=nodes(tree).find(n=>n.props?.id===prefix+'-type');assert.ok(select);
    assert.equal(select.props.value,'sedan');assert.equal(Boolean(select.props.required),false);
    assert.match(renderToStaticMarkup(tree),new RegExp('for="'+prefix+'-type"'));
    assert.deepEqual(nodes(select).filter(n=>n.type==='option').map(n=>n.props.value),['',...Object.keys(VEHICLE_TYPES)]);
    select.props.onChange({target:{value:'suv'}});assert.deepEqual(edits,[['vehicleType','suv']]);
    assert.equal(nodes(Fields({...props,disabled:true})).find(n=>n.props?.id===prefix+'-type').props.disabled,true);
  }
});
test('BUG-005157 Driver and booking-only validation preserve six body classes, primary/guest identity and explicit artwork',()=>{
  for(const type of Object.keys(VEHICLE_TYPES)) {
    const saved=validateDriverProfile({name:'A Driver',...vehicle,vehicleType:type,guestVehicles:[guest]});assert.equal(saved.valid,true);
    const [primary,friend]=getBookableVehicles(saved.normalised);
    assert.equal(primary.id,'primary');assert.equal(primary.type,'primary');assert.equal(primary.vehicleType,type);
    assert.equal(friend.id,'guest-friend');assert.equal(friend.type,'guest');assert.equal(friend.vehicleType,'hatchback');
    assert.equal(getVehicleBodyType(primary),type);assert.equal(getVehicleBodyType({vehicle_type:type}),type);
    const booking=validateBookingVehicle({...vehicle,vehicleType:type});assert.equal(booking.valid,true);assert.equal(bookingVehicleMetadata(booking.vehicle).vehicle_type,type);
  }
});
test('BUG-005157 missing or legacy role values never become an invented body class',()=>{
  assert.equal(normaliseDriverProfile(vehicle).vehicleType,'sedan');
  for(const type of [undefined,'','primary','guest','__proto__',{},'hovercraft']) {
    const [saved]=getBookableVehicles({...vehicle,vehicleType:undefined,vehicle_type:type});assert.equal(saved.vehicleType,'');assert.equal(normaliseVehicleType(type),'');
  }
  assert.equal(normaliseVehicleType(' SUV '),'suv');
  for(const type of ['primary','guest','hovercraft',{}]) {
    assert.equal(validateBookingVehicle({...vehicle,vehicleType:type}).valid,false);
    const result=validateDriverProfile({name:'A Driver',...vehicle,vehicleType:type,guestVehicles:[{...guest,vehicleType:type}]});
    assert.ok(result.errors.vehicleType);assert.ok(result.errors['guestVehicles.0.vehicleType']);
  }
});

function deliveryFixture({driverResult={id:'email_driver'},driverError=false,hostError=false,existing=null,readError=false,writeError=false}={}) {
  const sent=[],writes=[],errors=[],reads=[];let timestamp=existing;
  const booking={id:157,listing_id:7,renter_id:'driver',hours:1,total:11.5,status:'confirmed',paid_at:'2026-11-01T15:00:00Z',spot_label:'A',property_time_zone:'America/Toronto'};
  const db={from(table){const filters=[];let patch;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},update(value){patch=value;return q},single:async()=>{
    reads.push([table,...filters]);if(table==='bookings')return {data:readError?null:{confirmation_email_sent_at:timestamp},error:readError?{}:null};
    if(table==='listings')return {data:{title:'Synthetic',address:'PRIVATE FIXTURE',spaces:1,host_id:'host'}};
    const id=filters.find(([k])=>k==='id')?.[1];return {data:{name:id,email:id+'@example.invalid'}};
  },maybeSingle:async()=>{writes.push({table,patch,filters});if(!writeError)timestamp=patch.confirmation_email_sent_at;return {error:writeError?{}:null,data:writeError?null:{id:booking.id}}}};return q;}};
  const send=async(payload,options)=>{sent.push({payload,options});if(payload.to.startsWith('driver')){if(driverError)throw Error('driver provider failed');return driverResult;}if(hostError)throw Error('host provider failed');return {id:'email_host'};};
  const now=()=>new Date('2026-11-01T15:00:05Z');
  return {db,booking,sent,writes,errors,reads,send,now,timestamp:()=>timestamp};
}
test('BUG-005157 accepted Driver email records only its booking timestamp and preserves an existing acceptance on replay',async()=>{
  const f=deliveryFixture();const payload={to:'driver@example.invalid',subject:'Synthetic',html:'Driver'};
  assert.equal(await sendDriverBookingConfirmation(f.db,f.booking,payload,{send:f.send,now:f.now}),'sent');
  assert.equal(f.timestamp(),'2026-11-01T15:00:05.000Z');assert.deepEqual(f.writes,[{table:'bookings',patch:{confirmation_email_sent_at:f.timestamp()},filters:[['id',157],['renter_id','driver'],['confirmation_email_sent_at',null]]}]);
  assert.match(f.sent[0].options.idempotencyKey,/^parkshare-booking-confirmation-[a-f0-9]{64}$/);
  assert.equal(await sendDriverBookingConfirmation(f.db,f.booking,payload,{send:f.send,now:f.now}),'already_sent');assert.equal(f.sent.length,1);assert.equal(f.writes.length,1);
});
for(const [label,options] of [['provider failure',{driverError:true}],['skipped',{driverResult:{skipped:true}}],['no acceptance ID',{driverResult:{}}],['blank ID',{driverResult:{id:' '}}],['failed lookup',{readError:true}]])test(`BUG-005157 ${label} cannot mark a Driver confirmation sent`,async()=>{
  const f=deliveryFixture(options);await assert.rejects(()=>sendDriverBookingConfirmation(f.db,f.booking,{to:'driver@example.invalid'},{send:f.send,now:f.now}));assert.equal(f.writes.length,0);assert.equal(f.timestamp(),null);
});
test('BUG-005157 failed database acceptance write is surfaced instead of reporting a recorded send',async()=>{
  const f=deliveryFixture({writeError:true});await assert.rejects(()=>sendDriverBookingConfirmation(f.db,f.booking,{to:'driver@example.invalid'},{send:f.send,now:f.now}),/record booking confirmation/);assert.equal(f.timestamp(),null);assert.equal(f.sent.length,1);
});
const webhook=await readFile(process.env.QA_BOOKING_FIELDS_WEBHOOK || new URL('../api/stripe-webhook.js',import.meta.url),'utf8');
const bookingEmailCode=webhook.slice(webhook.indexOf('async function sendBookingConfirmationEmail('),webhook.indexOf('async function processPaidCheckout('));
for(const [label,options,accepted] of [['both accepted',{},true],['Host failed',{hostError:true},true],['Driver failed',{driverError:true},false],['Driver skipped',{driverResult:{skipped:true}},false]])test(`BUG-005157 actual webhook email path: ${label}`,async()=>{
  const f=deliveryFixture(options),deps={supabaseAdmin:f.db,getSessionWindow,formatBookingEmailTimes,deriveEmailSpotStates:()=>[true],renderParkingSpotImage:async()=>Buffer.from('image'),renderHostLogoPng:async()=>Buffer.from('logo'),renderDriverPortraitPng:async()=>Buffer.from('driver'),renderHostPortraitPng:async()=>Buffer.from('host'),confirmationEmailHtml:()=>'<p>Driver</p>',hostBookingNotificationHtml:()=>'<p>Host</p>',sendEmail:f.send,sendDriverBookingConfirmation:(db,b,p)=>sendDriverBookingConfirmation(db,b,p,{send:f.send,now:f.now}),SUPPORT_EMAIL:'support@example.invalid',console:{error:(...args)=>f.errors.push(args)}};
  const run=new Function(...Object.keys(deps),bookingEmailCode+';return sendBookingConfirmationEmail;')(...Object.values(deps));
  await run(f.booking);assert.deepEqual(f.sent.map(x=>x.payload.to).sort(),['driver@example.invalid','host@example.invalid']);assert.equal(Boolean(f.timestamp()),accepted);assert.equal(f.writes.length,accepted?1:0);
});

test('BUG-005157 refreshed application user retains the saved primary and guest body class',()=>{
 const code=app.slice(app.indexOf('function buildAppUser('),app.indexOf('// Guards the new satellite-map'));
 const build=new Function('normaliseDriverProfile','getDriverProfileCompletion',code+';return buildAppUser;')(normaliseDriverProfile,()=>({complete:true}));
 const user=build({id:'driver',role:'driver'},{id:'driver',email:'driver@example.invalid',user_metadata:{vehicle_type:'sedan',vehicle_make:'Honda',vehicle_model:'Civic',vehicle_colour:'Blue',license_plate:'TYPE 157',guest_vehicles:[guest]}});
 assert.equal(user.vehicleType,'sedan');assert.equal(user.guestVehicles[0].vehicleType,'hatchback');
});
test('BUG-005157 sendEmail forwards its deterministic provider key on the actual HTTP request',async()=>{
 const originalKey=process.env.RESEND_API_KEY,originalFetch=globalThis.fetch;process.env.RESEND_API_KEY='re_synthetic_test';
 try{
  const {sendEmail}=await import('../api/_email.js?bug005157');let request;
  globalThis.fetch=async(url,options)=>{request={url,options};return Response.json({id:'accepted_fixture'})};
  assert.deepEqual(await sendEmail({to:'fixture@example.invalid',subject:'Synthetic',html:'<p>Fixture</p>'},{idempotencyKey:'fixed-booking-fixture'}),{id:'accepted_fixture'});
  assert.equal(request.url,'https://api.resend.com/emails');assert.equal(request.options.headers['Idempotency-Key'],'fixed-booking-fixture');assert.deepEqual(JSON.parse(request.options.body).to,['fixture@example.invalid']);
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=originalKey;}
});
