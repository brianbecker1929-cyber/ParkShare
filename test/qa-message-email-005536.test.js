import test from 'node:test';
import assert from 'node:assert/strict';
process.env.EMAIL_FROM = 'ParkShare <qa@example.invalid>';
process.env.SUPABASE_URL = 'https://message-fixture.invalid';
process.env.APP_URL = 'https://qa.example.invalid';
const {processMessageEmail, processMessageNotifications} = await import('../api/_message-email-delivery.js');
const {messageNotificationHtml} = await import('../api/_email.js');
const NOW = new Date('2026-11-03T12:00:00Z');
function fixture() {
  const rows = {
    message_email_deliveries: [{message_id: 1, created_at: NOW.toISOString(), lease_until: '-infinity', sent_at: null, blocked_at: null, payload: null, first_attempt_at: null}],
    messages: [{id: 1, listing_id: 7, booking_id: 9, sender_id: 'driver', recipient_id: 'host', text: 'SECRET MESSAGE'}],
    listings: [{id: 7, host_id: 'host', address: 'SECRET ADDRESS'}],
    bookings: [{id: 9, listing_id: 7, renter_id: 'driver'}],
    profiles: [{id: 'host', email: 'host@example.invalid'}, {id: 'driver', email: 'driver@example.invalid'}],
  };
  const calls = [], requests = [], accepted = new Map();
  let markerError = false, lookupError = false;
  const db = {from(table) {
    let patch = null, filters = [], one = false, limit = Infinity;
    const q = {select() {return q;}, update(value) {patch = value; return q;},
      eq(k,v) {filters.push(r=>r[k]===v);return q;}, is(k,v) {filters.push(r=>r[k]===v);return q;},
      lte(k,v) {filters.push(r=>r[k]==='-infinity'||Date.parse(r[k])<=Date.parse(v));return q;},
      order() {return q;}, limit(n) {limit=n;return q;}, single() {one=true;return q;}, maybeSingle() {one=true;return q;},
      then(resolve,reject) {
        try {
          calls.push({table,patch});
          if (lookupError && table === 'profiles') return Promise.resolve({error:{message:'PRIVATE DATABASE ERROR'}}).then(resolve,reject);
          const selected = rows[table].filter(r=>filters.every(f=>f(r))).slice(0,limit);
          if (markerError && patch?.sent_at) return Promise.resolve({error:{message:'uncertain marker'}}).then(resolve,reject);
          if (patch) selected.forEach(r=>Object.assign(r,structuredClone(patch)));
          return Promise.resolve({data:structuredClone(one ? selected[0]??null : selected),error:null}).then(resolve,reject);
        } catch(error) {return Promise.reject(error).then(resolve,reject);}
      }};return q;
  }};
  const send = async (payload,options) => {
    requests.push({payload:structuredClone(payload),options});
    if (!accepted.has(options.idempotencyKey)) accepted.set(options.idempotencyKey,{id:'provider-'+accepted.size});
    return accepted.get(options.idempotencyKey);
  };
  return {db,rows,calls,requests,send,accepted,get job(){return rows.message_email_deliveries[0];},
    markerFail(value=true){markerError=value;},lookupFail(){lookupError=true;},
    run(options={}){return processMessageEmail(db,{message_id:1},{now:NOW,send,...options});}};
}

test('BUG-005536 Driver-to-Host notification is private, generic and points to the QA booking thread', async()=>{
  const h=fixture();assert.equal(await h.run(),'accepted');
  assert.deepEqual(h.requests[0].payload.to,['host@example.invalid']);
  const mail=JSON.stringify(h.requests[0].payload);
  for(const secret of ['SECRET MESSAGE','SECRET ADDRESS','driver@example.invalid']) assert.ok(!mail.includes(secret));
  for(const key of ['cc','bcc','reply_to']) assert.ok(!h.requests[0].payload[key]);
  assert.ok(mail.includes('https://qa.example.invalid/parking?message_booking=9'));
  assert.ok(h.job.provider_id);assert.equal(h.job.sent_at,NOW.toISOString());
  assert.equal(await h.run(),'busy');assert.equal(h.requests.length,1);
});
test('Host reply targets only its actual Driver; unbooked conversations use the messages page',async()=>{
  const h=fixture();Object.assign(h.rows.messages[0],{sender_id:'host',recipient_id:'driver'});
  assert.equal(await h.run(),'accepted');assert.deepEqual(h.requests[0].payload.to,['driver@example.invalid']);
  const direct=fixture();direct.rows.messages[0].booking_id=null;
  assert.equal(await direct.run(),'accepted');assert.ok(direct.requests[0].payload.html.includes('https://qa.example.invalid/messages'));
  const reply=fixture();Object.assign(reply.rows.messages[0],{booking_id:null,sender_id:'host',recipient_id:'driver'});
  reply.rows.messages.push({id:2,listing_id:7,sender_id:'driver',recipient_id:'host'});
  assert.equal(await reply.run(),'accepted');
});
test('unrelated, self, forged booking/listing and unestablished Host recipients are blocked before provider contact',async()=>{
  for(const alter of [h=>h.rows.messages[0].recipient_id='stranger',h=>h.rows.messages[0].sender_id='stranger',
    h=>h.rows.messages[0].recipient_id='driver',h=>h.rows.bookings[0].listing_id=8,
    h=>Object.assign(h.rows.messages[0],{booking_id:null,sender_id:'host',recipient_id:'driver'}),
    h=>h.rows.profiles[0].email='host@example.invalid,other@example.invalid',h=>h.rows.messages.splice(0)]){
    const h=fixture();alter(h);assert.equal(await h.run(),'blocked');assert.equal(h.requests.length,0);assert.equal(h.job.blocked_reason,'participant');
  }
});
test('a database failure is retryable, never mistaken for an unsafe or delivered message',async()=>{
  const h=fixture();h.lookupFail();await assert.rejects(h.run(),/recipient lookup failed/);assert.equal(h.job.sent_at,null);assert.equal(h.job.blocked_at,null);assert.equal(h.requests.length,0);
});
test('simultaneous workers claim once and marker-loss retry reuses the identical payload and idempotency key',async()=>{
  const h=fixture();assert.deepEqual((await Promise.all([h.run(),h.run(),h.run()])).sort(),['accepted','busy','busy']);assert.equal(h.requests.length,1);
  const retry=fixture();retry.markerFail();await assert.rejects(retry.run(),/acceptance marker failed/);
  retry.markerFail(false);retry.job.lease_until='-infinity';
  assert.equal(await retry.run({now:new Date(NOW.getTime()+180_000)}),'accepted');
  assert.equal(retry.requests.length,2);assert.equal(retry.accepted.size,1);assert.deepEqual(retry.requests[0],retry.requests[1]);
});
test('a frozen recipient that changes, unsafe extra addressing and expired attempts are suppressed without rebuilding payloads',async()=>{
  for(const mutate of [h=>h.rows.profiles[0].email='changed@example.invalid',h=>h.job.payload.cc=['driver@example.invalid'],
    h=>h.job.payload.bcc=['other@example.invalid'],h=>h.job.payload.reply_to='other@example.invalid',h=>h.job.first_attempt_at='2026-11-02T12:00:00Z']){
    const h=fixture();h.markerFail();await assert.rejects(h.run());h.markerFail(false);h.job.lease_until='-infinity';mutate(h);
    assert.equal(await h.run(),'blocked');assert.equal(h.requests.length,1);assert.equal(h.job.blocked_reason,'snapshot');
  }
  const old=fixture();old.job.created_at='2026-11-02T12:00:00Z';assert.equal(await old.run(),'blocked');assert.equal(old.requests.length,0);
});
test('provider 429/network/server failures remain retryable, permanent API failures block, missing acceptance never marks sent',async()=>{
  for(const message of ['network timeout','Resend API error (429): rate limit','Resend API error (503): unavailable']){
    const h=fixture();await assert.rejects(h.run({send:async()=>{throw Error(message);}}));assert.equal(h.job.sent_at,null);assert.equal(h.job.blocked_at,null);
  }
  for(const code of [400,401,403,409,422]){
    const h=fixture();assert.equal(await h.run({send:async()=>{throw Error(`Resend API error (${code}): private details`);}}),'blocked');assert.equal(h.job.blocked_reason,'provider_4xx');
  }
  for(const result of [undefined,{}, {skipped:true}]){const h=fixture();await assert.rejects(h.run({send:async()=>result}));assert.equal(h.job.sent_at,null);}
});
test('pending worker is bounded, skips accepted jobs and obeys its deadline',async()=>{
  const h=fixture();assert.deepEqual(await processMessageNotifications(h.db,{now:NOW,send:h.send}),{accepted:1,failed:0,blocked:0});
  assert.deepEqual(await processMessageNotifications(h.db,{now:NOW,send:h.send}),{accepted:0,failed:0,blocked:0});
  const idle=fixture();assert.deepEqual(await processMessageNotifications(idle.db,{now:NOW,deadline:0,send:idle.send}),{accepted:0,failed:0,blocked:0});assert.equal(idle.requests.length,0);
  const batch=fixture();for(let id=2;id<=6;id++){batch.rows.messages.push({...batch.rows.messages[0],id});batch.rows.message_email_deliveries.push({...batch.job,message_id:id});}
  assert.deepEqual(await processMessageNotifications(batch.db,{now:NOW,send:batch.send}),{accepted:5,failed:0,blocked:0});assert.equal(batch.requests.length,5);assert.equal(batch.rows.message_email_deliveries[5].sent_at,null);
});
test('notification links require an HTTPS origin and never embed arbitrary booking IDs',()=>{
  for(const bookingId of ['9','<script>',-1,NaN])assert.ok(messageNotificationHtml({bookingId}).includes('/messages'));
  const old=process.env.APP_URL;
  try {for(const url of ['http://qa.example.invalid','https://user:pass@qa.example.invalid','https://qa.example.invalid/path']){process.env.APP_URL=url;assert.throws(()=>messageNotificationHtml(),/APP_URL/);}}
  finally{process.env.APP_URL=old;}
});
