import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.RESEND_API_KEY = 'sample-reminder-key';
process.env.EMAIL_FROM = 'ParkShare <test@example.invalid>';
const { deliverReminder } = await import('../api/_reminder-delivery.js');
const originalFetch = globalThis.fetch;
const now = Date.now();
const booking = { id: 42, end: now + 30 * 60_000 };
const message = { to: 'driver@example.invalid', cc: 'host@example.invalid', subject: 'Halfway', html: '<p>30 minutes</p>' };

// Stateful Supabase model honours the atomic conditional claim and immutable
// first insert. Transport assertions exercise the real Resend request builder.
function fixture() {
  const state = { row: null, marker: null, calls: [], patchError: false, acceptanceError: false, status: 'confirmed', paid: true, end: booking.end };
  const db = { from(table) {
    let verb = 'get', body, filters = [], selected = false;
    const q = {
      upsert(v) { verb = 'insert'; body = v; return q; },
      update(v) { verb = 'update'; body = v; return q; },
      select() { selected = true; return q; },
      eq(k,v) { filters.push([k,v]); return q; },
      is(k,v) { filters.push([k,v]); return q; },
      lte(k,v) { filters.push([k,{ lte: v }]); return q; },
      single() { return q; }, maybeSingle() { return q; },
      then(resolve, reject) {
        try {
          let data = null, error = null;
          if (table === 'booking_reminder_deliveries') {
            if (verb === 'insert' && !state.row) state.row = { ...body, created_at: new Date(now).toISOString(), sent_at: null, provider_id: null, lease_until: new Date(0).toISOString() };
            if (verb === 'get') data = structuredClone(state.row);
            if (verb === 'update') {
              const eligible = filters.every(([k,v]) => typeof v === 'object' && v?.lte ? Date.parse(state.row[k]) <= Date.parse(v.lte) : state.row[k] === v);
              if (eligible) {
                if (body.provider_id && state.acceptanceError) error = { message:'synthetic database failure' };
                else { Object.assign(state.row, body); if (selected) data = { id:state.row.id }; }
              }
            }
          } else if (table === 'bookings') {
            if (verb === 'get') data = { status:state.status, hours:1, paid_at:state.paid ? new Date(state.end-3600_000).toISOString() : null, scheduled_starts_at:new Date(state.end-3600_000).toISOString() };
            else if (state.patchError) error = { message: 'synthetic marker error' };
            else state.marker = body;
          } else throw Error('Unexpected table');
          return Promise.resolve({ data, error }).then(resolve,reject);
        } catch(e) { return Promise.reject(e).then(resolve,reject); }
      },
    };
    return q;
  }};
  globalThis.fetch = async (url,init) => {
    assert.equal(url,'https://api.resend.com/emails');
    state.calls.push({ payload:JSON.parse(init.body), key:init.headers['Idempotency-Key'] });
    return Response.json({ id:'email-accepted' });
  };
  return { db, state };
}

test.afterEach(() => { globalThis.fetch = originalFetch; });
test('scheduler calls reminders every minute and retains photo cleanup',async()=>{
  const config = JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.ok(config.crons.some(c=>c.path==='/api/send-reminders' && c.schedule==='* * * * *'));
  assert.ok(config.crons.some(c=>c.path==='/api/cleanup-listing-photos'));
});
test('overlapping invocations accept one delivery and persist provider receipt',async()=>{
  const {db,state} = fixture();
  const outcomes = await Promise.all([deliverReminder(db,booking,'halfway',message),deliverReminder(db,booking,'halfway',message)]);
  assert.equal(outcomes.filter(Boolean).length,1);
  assert.equal(state.calls.length,1);
  assert.match(state.calls[0].key,/^parkshare-[a-f0-9]{16}-booking-42-halfway$/);
  assert.deepEqual(state.calls[0].payload.to,[message.to]);
  assert.deepEqual(state.calls[0].payload.cc,[message.cc]);
  assert.equal(state.row.provider_id,'email-accepted');
  await deliverReminder(db,booking,'halfway',message);
  assert.equal(state.calls.length,1);
});
test('failed booking marker is repaired without another email',async()=>{
  const {db,state} = fixture(); state.patchError = true;
  await assert.rejects(deliverReminder(db,booking,'halfway',message),/booking marker/);
  assert.equal(state.calls.length,1);
  state.patchError = false;
  await deliverReminder(db,booking,'halfway',message);
  assert.equal(state.calls.length,1);
  assert.ok(state.marker.reminder_halfway_sent_at);
});
test('uncertain acceptance retries the identical payload and key after lease expires',async()=>{
  const {db,state} = fixture(); state.acceptanceError = true;
  await assert.rejects(deliverReminder(db,booking,'halfway',message),/acceptance update/);
  assert.equal(state.marker,null);
  assert.equal(await deliverReminder(db,booking,'halfway',{...message,html:'changed'}),false);
  assert.equal(state.calls.length,1);
  state.acceptanceError = false;
  await deliverReminder(db,booking,'halfway',{...message,html:'changed'},new Date(now+121_000));
  assert.equal(state.calls.length,2);
  assert.deepEqual(state.calls[0],state.calls[1]);
});
test('provider error leaves marker unset and retry reuses the frozen request',async()=>{
  const {db,state} = fixture();
  globalThis.fetch = async()=>Response.json({message:'temporary failure'},{status:503});
  await assert.rejects(deliverReminder(db,booking,'ending',message),/503/);
  assert.equal(state.marker,null); assert.equal(state.row.sent_at,null);
});
for (const variant of ['cancelled','unpaid','extended','ended']) test(`rechecks ${variant} session before provider request`,async()=>{
  const {db,state} = fixture();
  if (variant==='cancelled') state.status='cancelled';
  if (variant==='unpaid') state.paid=false;
  if (variant==='extended') state.end+=3600_000;
  if (variant==='ended') state.end=now-1000;
  assert.equal(await deliverReminder(db,booking,'halfway',message),false);
  assert.equal(state.calls.length,0); assert.equal(state.marker,null);
});
test('expired provider idempotency window never causes a second send',async()=>{
  const {db,state} = fixture();
  await deliverReminder(db,booking,'halfway',message);
  state.row.sent_at=null;state.row.provider_id=null;state.marker=null;
  state.row.created_at = new Date(now-23*3600_000).toISOString();
  await assert.rejects(deliverReminder(db,booking,'halfway',message),/reconciliation/);
  assert.equal(state.calls.length,1);assert.equal(state.marker,null);
});

const { dueReminder } = await import('../api/_reminder-window.js');
const start = Date.parse('2026-10-21T12:00:00Z');
const scheduled = { status:'confirmed', paid_at:'2026-05-01T09:00:00Z', scheduled_starts_at:new Date(start).toISOString(), property_time_zone:'Europe/Bucharest', hours:1 };
test('canonical future session paid months ago reaches exact halfway and 15-minute thresholds',()=>{
  assert.equal(dueReminder(scheduled,start-1),null);
  assert.equal(dueReminder(scheduled,start+30*60_000-1),null);
  assert.deepEqual(dueReminder(scheduled,start+30*60_000),{kind:'halfway',end:start+3600_000});
  assert.deepEqual(dueReminder(scheduled,start+45*60_000),{kind:'ending',end:start+3600_000});
  assert.equal(dueReminder(scheduled,start+3600_000),null);
});
test('late runs send only ending; sent, unpaid, cancelled and invalid windows are suppressed',()=>{
  assert.equal(dueReminder({...scheduled,reminder_ending_sent_at:'sent'},start+50*60_000),null);
  assert.equal(dueReminder({...scheduled,reminder_halfway_sent_at:'sent'},start+35*60_000),null);
  for (const b of [{...scheduled,status:'cancelled'},{...scheduled,paid_at:null}]) assert.equal(dueReminder(b,start+35*60_000),null);
  assert.throws(()=>dueReminder({...scheduled,scheduled_starts_at:'invalid'},start),RangeError);
});
test('Book Now uses paid time; a 30-minute session sends only ending at its midpoint',()=>{
  assert.equal(dueReminder({...scheduled,scheduled_starts_at:null,paid_at:new Date(start).toISOString()},start+30*60_000).kind,'halfway');
  assert.equal(dueReminder({...scheduled,hours:0.5},start+15*60_000).kind,'ending');
});
