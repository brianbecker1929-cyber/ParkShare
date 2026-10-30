import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getSessionWindow} from '../api/_booking-rules.js';
import {formatBookingEmailTimes} from '../api/_booking-email-times.js';
import {deriveEmailSpotStates} from '../api/_driveway-image.js';
import {buildEmailPayload, extensionConfirmedHtml, hostExtensionConfirmedHtml} from '../api/_email.js';

const source = await readFile(new URL('../api/stripe-webhook.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('async function sendExtensionConfirmedEmail('), source.indexOf('async function sendBookingConfirmationEmail('));
function harness({hostEmail = 'host@example.invalid', hostError = false, missingListing = false, missingDriver = false, missingBooking = false, failAudience = null, halfHour = false, imageFailure = false} = {}) {
  const sent = [], reads = [], errors = [];
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
  const image = async () => { if(imageFailure) throw Error('Image unavailable'); return Buffer.from('synthetic-inline-image'); };
  const deps = {supabaseAdmin:db, getSessionWindow, formatBookingEmailTimes, deriveEmailSpotStates,
    renderParkingSpotImage:image, renderHostLogoPng:image, renderDriverPortraitPng:image, renderHostPortraitPng:image,
    extensionConfirmedHtml, hostExtensionConfirmedHtml, sendEmail:async args=>{ const payload=buildEmailPayload(args); sent.push(payload); if(args.to.startsWith(failAudience || 'NO-FAIL')) throw Error('Provider failure'); }, console:{error:(...args)=>errors.push(args)}, SUPPORT_EMAIL:'support@example.invalid'};
  const run = new Function(...Object.keys(deps), code+';return sendExtensionConfirmedEmail;')(...Object.values(deps));
  return {sent,reads,errors,run:()=>run(42,halfHour?0.5:1,1150)};
}

test('extension delivers private recipient-specific receipts with matching payment and local end time', async()=>{
  const h=harness({hostEmail:' host@example.invalid '});await h.run();
  assert.equal(h.sent.length,2);const [driver,host]=h.sent;
  assert.deepEqual(driver.to,['driver@example.invalid']);assert.deepEqual(host.to,['host@example.invalid']);
  for(const email of h.sent){
    assert.equal(email.cc,undefined);assert.equal(email.bcc,undefined);
    for(const text of ['PK-42','Spot H','QA 116','Honda','Civic','America/Toronto local time','$11.50 CAD','11:00']) assert.ok(email.html.includes(text),text);
    assert.doesNotMatch(email.html, /driver@example|host@example/);
    assert.equal(email.attachments.length,3);
  }
  assert.equal(driver.subject,'Extension confirmed — +1 hour added');
  assert.match(driver.html,/Hi <strong>Driver<\/strong>/);
  assert.match(driver.html,/Add More Time/);
  assert.match(host.html,/Hi <strong>Host<\/strong>/);
  assert.match(host.html,/Driver has paid for extra time/);
  assert.match(host.html,/Extension charged to Driver/);
  assert.match(host.html,/not your payout/);
  assert.match(host.html,/host-dashboard/);
  assert.match(host.html,/Message Driver/);
  assert.doesNotMatch(host.html,/Add More Time|extend_booking|Message Host/);
  assert.match(driver.html,/parkshare-parker-portrait-ext-42/);
  assert.match(host.html,/parkshare-william-portrait-ext-42/);
  assert.doesNotMatch(host.html,/parkshare-parker-portrait-ext-42/);
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
test('missing booking sends nothing; a missing Driver address does not suppress the Host confirmation',async()=>{
  const missing=harness({missingBooking:true});await assert.rejects(missing.run(),/Booking not found/);assert.equal(missing.sent.length,0);
  const h=harness({missingDriver:true});await h.run();assert.equal(h.sent.length,1);
  assert.deepEqual(h.sent[0].to,['host@example.invalid']);assert.equal(h.sent[0].cc,undefined);
});
for(const failAudience of ['driver','host']) test(`a ${failAudience} send failure does not prevent the other private delivery`,async()=>{
  const h=harness({failAudience});await h.run();assert.equal(h.sent.length,2);assert.equal(h.errors.length,1);
});
test('half-hour extension and image fallback preserve both confirmations',async()=>{
  const h=harness({halfHour:true,imageFailure:true});await h.run();assert.equal(h.sent.length,2);
  for(const email of h.sent){assert.match(email.html,/30 minutes/);assert.match(email.html,/Driveway preview unavailable/);}
  assert.match(h.sent[1].html,/parkshare-william-portrait.png/);
});
test('Host extension template escapes names and uses the configured QA origin for actions',()=>{
  const previous=process.env.APP_URL;
  try{
    process.env.APP_URL='https://parkshare-qa-git-qa-recovery-preflight-oct27-eska-technologies.vercel.app';
    const html=hostExtensionConfirmedHtml({bookingId:42,hostName:'<script>Host</script>',driverName:'Driver & Friend'});
    assert.match(html,/&lt;script&gt;Host/);assert.match(html,/Driver &amp; Friend/);
    assert.doesNotMatch(html,/<script>|https:\/\/www\.myparkshare\.ca/);
    assert.match(html,/recovery-preflight-oct27-eska-technologies\.vercel\.app\/host-dashboard/);
  } finally {if(previous===undefined)delete process.env.APP_URL;else process.env.APP_URL=previous;}
});
