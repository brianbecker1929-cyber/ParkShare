import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateHostProfile, hostProfilePayload} from '../src/lib/hostProfile.js';

const source = (await readFile(new URL('../api/host-profile.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace('export default async function handler', 'return async function handler');
function fixture({role = 'host', identity = 'A', fail, missingProfile = false} = {}) {
  const profiles = {A: {id: 'A', role, name: 'Original Host'}, B: {id: 'B', role: 'host', name: 'Other Host'}};
  const users = {A: {id: 'A', email: 'a@example.invalid', user_metadata: {name: 'Original Host', phone: '4165550100', role: 'driver', guest_vehicles: [{id: 'keep'}], privateNote: 'DO NOT EXPOSE'}}, B: {id: 'B', email: 'b@example.invalid', user_metadata: {phone: '6045550100'}}};
  const events = [];
  const admin = {from(table) {
    assert.equal(table, 'profiles'); let patch = null, selected, filters = {};
    const query = {select(fields) {selected = fields; return query;}, update(value) {patch = value; return query;}, eq(key, value) {filters[key] = value; return query;}, async maybeSingle() {
      events.push({table, patch, filters: {...filters}, selected});
      if (fail === 'role' && !patch || fail === 'name' && patch) return {error: {code: 'synthetic'}};
      const row = profiles[filters.id];
      if (missingProfile || !row || patch && (fail === 'no_rows' || row.role !== filters.role)) return {data: null};
      if (patch) Object.assign(row, patch);
      return {data: {...row}};
    }};
    return query;
  }, auth: {admin: {async updateUserById(id, value) {
    events.push({authId: id, value});
    if (fail === 'auth') return {error: {message: 'PRIVATE PROVIDER FAILURE'}};
    if (fail === 'malformed') return {data: {user: {id: 'B'}}};
    users[id].user_metadata = {...users[id].user_metadata, ...value.user_metadata};
    return {data: {user: structuredClone(users[id])}};
  }}}};
  const requireUser = async (req, res) => {if (!identity) {res.status(401).json({error: 'Sign in required'}); return null;} return structuredClone(users[identity]);};
  const handler = new Function('requireUser', 'supabaseAdmin', 'validateHostProfile', 'hostProfilePayload', source)(requireUser, admin, validateHostProfile, hostProfilePayload);
  const run = async (method = 'GET', body) => {const res = {code: 200, headers: {}, setHeader(k, v) {this.headers[k] = v;}, status(v) {this.code = v; return this;}, json(v) {this.body = v; return this;}}; await handler({method, body}, res); return res;};
  return {run, profiles, users, events};
}

test('BUG-005461 GET exposes only the current database-authorized Host profile with private no-store caching', async () => {
  const f = fixture(), res = await f.run();
  assert.equal(res.code, 200); assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(res.body, {profile: {id: 'A', role: 'host', name: 'Original Host', phone: '4165550100', email: 'a@example.invalid'}});
  assert.deepEqual(f.events, [{table: 'profiles', patch: null, filters: {id: 'A'}, selected: 'id, name, role'}]);
  assert.doesNotMatch(JSON.stringify(res.body), /privateNote|DO NOT EXPOSE|guest_vehicles|Other Host|6045550100/);
});

test('signed-out, Driver, unsupported-role and missing-profile requests cannot read or mutate Host details', async () => {
  for (const options of [{identity: null}, {role: 'driver'}, {role: 'admin'}, {missingProfile: true}]) for (const method of ['GET', 'PATCH']) {
    const f = fixture(options), res = await f.run(method, {name: 'New Host', phone: ''});
    assert.equal(res.code, options.identity === null ? 401 : 403);
    assert.ok(!res.body.profile); assert.ok(f.events.every(event => !event.patch && !event.authId));
  }
});

test('Host PATCH persists canonical name/contact values and a subsequent GET returns them without altering another Host', async () => {
  const f = fixture(), other = structuredClone(f.users.B);
  const res = await f.run('PATCH', {name: '  Saved Host  ', phone: ' +1 (416) 555-0199 '});
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.profile, {id: 'A', role: 'host', name: 'Saved Host', phone: '+1 (416) 555-0199', email: 'a@example.invalid'});
  assert.deepEqual((await f.run()).body.profile, res.body.profile);
  assert.deepEqual(f.users.B, other); assert.equal(f.profiles.B.name, 'Other Host');
  assert.deepEqual(f.events.find(event => event.patch).filters, {id: 'A', role: 'host'});
  assert.deepEqual(f.events.find(event => event.authId), {authId: 'A', value: {user_metadata: {name: 'Saved Host', phone: '+1 (416) 555-0199'}}});
  assert.equal(f.users.A.user_metadata.role, 'driver'); assert.deepEqual(f.users.A.user_metadata.guest_vehicles, [{id: 'keep'}]);
});

test('forged identity, role, email, payout and vehicle attributes are rejected before writes', async () => {
  for (const field of ['id', 'userId', 'hostId', 'role', 'email', 'phone_confirm', 'password', 'app_metadata', 'stripe_account_id', 'vehicleMake']) {
    const f = fixture(), res = await f.run('PATCH', {name: 'Host Name', phone: '', [field]: 'B'});
    assert.equal(res.code, 400, field); assert.ok(f.events.every(event => !event.patch && !event.authId));
  }
});

test('name/phone validation fails before writes while an optional blank phone is accepted', async () => {
  for (const body of [null, [], {name: '', phone: ''}, {name: 'A', phone: ''}, {name: 'A'.repeat(81), phone: ''}, {name: 'Host', phone: '123'}, {name: 'Host', phone: {}}, {name: 'Host', phone: 'phone 4165550100'}, {name: 'Host', phone: '1'.repeat(16)}]) {
    const f = fixture(), res = await f.run('PATCH', body);
    assert.equal(res.code, 400); assert.ok(f.events.every(event => !event.patch && !event.authId));
  }
  assert.equal((await fixture().run('PATCH', {name: 'Valid Host', phone: ''})).code, 200);
});

test('provider errors, missing update rows and malformed Auth replies cannot claim a successful save or expose provider errors', async () => {
  for (const fail of ['role', 'name', 'auth', 'malformed', 'no_rows']) {
    const f = fixture({fail}), res = await f.run('PATCH', {name: 'Saved Name', phone: ''});
    assert.equal(res.code, 503, fail); assert.ok(!res.body.profile); assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE PROVIDER FAILURE/);
    assert.equal(res.body.saveMayHaveCompleted, fail !== 'role');
    if (['name', 'no_rows'].includes(fail)) assert.ok(!f.events.some(event => event.authId));
    if (fail === 'auth') {assert.equal(f.profiles.A.name, 'Saved Name'); assert.equal(f.users.A.user_metadata.phone, '4165550100'); assert.match(res.body.error, /Reload/);}
  }
});

test('unsupported methods fail without any account read and advertise only GET/PATCH', async () => {
  for (const method of ['POST', 'DELETE', 'HEAD', 'PUT']) {
    const f = fixture(), res = await f.run(method);
    assert.equal(res.code, 405); assert.equal(res.headers.Allow, 'GET, PATCH'); assert.equal(f.events.length, 0);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  }
});
