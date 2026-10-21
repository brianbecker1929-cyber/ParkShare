import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getSessionWindow} from '../api/_booking-rules.js';
import {formatBookingEmailTimes} from '../api/_booking-email-times.js';
import {deriveEmailSpotStates} from '../api/_driveway-image.js';
import {buildEmailPayload, extensionConfirmedHtml} from '../api/_email.js';

const source = await readFile(new URL('../api/stripe-webhook.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('async function sendExtensionConfirmedEmail('), source.indexOf('async function sendBookingConfirmationEmail('));
function harness({hostEmail = 'host@example.invalid', hostError = false, missingListing = false, missingDriver = false, missingBooking = false} = {}) {
  const sent = [], reads = [];
  const booking = {id:42, listing_id:7, renter_id:'driver', hours:2, paid_at:'2026-10-21T13:00:00Z', spot_label:'H', property_time_zone:'America/Toronto', vehicle_make:'Honda', vehicle_model:'Civic', vehicle_colour:'Blue', license_plate:'QA 116'};
  const rows = {bookings:{42:missingBooking ? null : booking}, listings:{7:missingListing ? null : {address:'12 Synthetic Crescent', spaces:8, host_id:'owner'}}, profiles:{driver:{name:'Driver', email:missingDriver ? null : 'driver@example.invalid'}, owner:{name:'Host', email:hostEmail}}};
  const db = {from(table) {
    let fields, id;
    return {select(value){fields=value;return this;}, eq(key,value){assert.equal(key,'id');id=value;return this;}, async single(){
      reads.push({table,id,fields});
      if (hostError && table === 'profiles' && id === 'owner') return {data:null,error:{code:'503'}};
      const row=rows[table][id];
      return {data:row && Object.fromEntries(fields.split(',').map(key=>[key.trim(),row[key.trim()]]))};
    }};
  }};
  const image = async () => Buffer.from('synthetic-inline-image');
  const deps = {supabaseAdmin:db, getSessionWindow, formatBookingEmailTimes, deriveEmailSpotStates,
    renderParkingSpotImage:image, renderHostLogoPng:image, renderDriverPortraitPng:image,
    extensionConfirmedHtml, sendEmail:async args=>sent.push(buildEmailPayload(args)), SUPPORT_EMAIL:'support@example.invalid'};
  const run = new Function(...Object.keys(deps), code+';return sendExtensionConfirmedEmail;')(...Object.values(deps));
  return {sent,reads,run:()=>run(42,1,1150)};
}

test('extension confirmation copies the authoritative listing Host and preserves the receipt and local end time', async()=>{
  const h=harness({hostEmail:' host@example.invalid '});await h.run();
  assert.equal(h.sent.length,1);const email=h.sent[0];
  assert.deepEqual(email.to,['driver@example.invalid']);assert.deepEqual(email.cc,['host@example.invalid']);
  assert.equal(email.subject,'Extension confirmed — +1 hour added');
  for(const text of ['PK-42','Spot H','QA 116','Honda','Civic','America/Toronto local time','$11.50 CAD','11:00']) assert.ok(email.html.includes(text),text);
  assert.equal(email.attachments.length,3);
  assert.deepEqual(h.reads.filter(row=>row.table==='profiles').map(({id})=>id),['driver','owner']);
});
for (const hostEmail of [null,'','   ',' DRIVER@EXAMPLE.INVALID ']) test(`missing or duplicate Host mailbox ${JSON.stringify(hostEmail)} preserves Driver delivery without CC`,async()=>{
  const h=harness({hostEmail});await h.run();assert.equal(h.sent.length,1);assert.deepEqual(h.sent[0].to,['driver@example.invalid']);assert.equal(h.sent[0].cc,undefined);
});
test('unavailable Host lookup or missing listing never adds another recipient or blocks the Driver receipt',async()=>{
  for(const options of [{hostError:true},{missingListing:true}]){
    const h=harness(options);await h.run();assert.equal(h.sent.length,1);assert.equal(h.sent[0].cc,undefined);
    if(options.missingListing)assert.ok(!h.reads.some(row=>row.id==='owner'));
  }
});
test('missing booking or Driver address cannot send a misleading Host-only confirmation',async()=>{
  const missing=harness({missingBooking:true});await assert.rejects(missing.run(),/Booking not found/);assert.equal(missing.sent.length,0);
  const h=harness({missingDriver:true});await h.run();assert.equal(h.sent.length,0);
});
