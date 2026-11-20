import test from 'node:test';
import assert from 'node:assert/strict';
import {requestHostProfile} from '../src/lib/hostProfile.js';
const profile = {id: 'A', role: 'host', name: 'Host Name', phone: '4165550100', email: 'a@example.invalid'};
const session = id => ({data: {session: id ? {user: {id}, access_token: id + '-token'} : null}});
const later = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
function fixture({auth = async () => session('A'), reply = async () => Response.json({profile})} = {}) {
  let reads = 0; const requests = [];
  const client = {auth: {getSession: () => auth(++reads)}};
  const run = (options = {}) => requestHostProfile(client, {accountId: 'A', isCurrent: () => true, ...options}, async (url, init) => {requests.push({url, ...init}); return reply();});
  return {run, requests, get reads() {return reads;}};
}
test('Host reads and saves use a bearer-bound no-store endpoint, strip extra response fields and recheck the current session', async () => {
  const f = fixture({reply: async () => Response.json({profile: {...profile, secret: 'DROP'}})});
  assert.deepEqual(await f.run(), {id: 'A', name: 'Host Name', phone: '4165550100', email: 'a@example.invalid'});
  assert.equal(f.requests[0].url, '/api/host-profile'); assert.equal(f.requests[0].method, 'GET'); assert.equal(f.requests[0].cache, 'no-store'); assert.equal(f.requests[0].headers.Authorization, 'Bearer A-token');
  await f.run({profile: {name: ' Host Name ', phone: '4165550100', role: 'admin'}});
  assert.equal(f.requests[1].method, 'PATCH'); assert.deepEqual(JSON.parse(f.requests[1].body), {name: 'Host Name', phone: '4165550100'}); assert.equal(f.reads, 4);
});
test('invalid drafts, missing/mismatched sessions and obsolete work never send a profile request', async () => {
  const invalid = fixture(); await assert.rejects(invalid.run({profile: {name: '', phone: ''}})); assert.equal(invalid.reads, 0); assert.equal(invalid.requests.length, 0);
  for (const id of [null, 'B']) {const f = fixture({auth: async () => session(id)}); await assert.rejects(f.run(), /account changed/); assert.equal(f.requests.length, 0);}
  const pending = later(), f = fixture({auth: () => pending.promise}); let active = true;
  const work = f.run({isCurrent: () => active}); active = false; pending.resolve(session('A'));
  assert.equal(await work, null); assert.equal(f.requests.length, 0);
});
test('retired reads and account changes during the HTTP reply cannot publish a profile or alter SDK session storage', async () => {
  const pending = later(), f = fixture({reply: () => pending.promise}); let active = true;
  const work = f.run({isCurrent: () => active}); await new Promise(r => setImmediate(r)); active = false;
  pending.resolve(Response.json({profile})); assert.equal(await work, null);
  const changed = fixture({auth: async n => session(n === 1 ? 'A' : 'B')}); await assert.rejects(changed.run(), /account changed/); assert.equal(changed.requests.length, 1);
});
test('uncertain, malformed and wrong-account responses never report a confirmed save', async () => {
  for (const value of [null, {}, {profile: {...profile, id: 'B'}}, {profile: {...profile, role: 'driver'}}, {profile: {...profile, phone: 5}}]) {
    const f = fixture({reply: async () => Response.json(value)}); await assert.rejects(f.run({profile}), /confirm your saved profile/);
  }
  for (const kind of ['network', 'service', 'json']) {
    const f = fixture({reply: async () => {if (kind === 'network') throw Error('PRIVATE FAILURE'); if (kind === 'json') return {ok: true, json: async () => {throw Error('PRIVATE FAILURE');}}; return Response.json({error: 'PRIVATE FAILURE'}, {status: 503});}});
    await assert.rejects(f.run({profile}), error => /Reload/.test(error.message) && !/PRIVATE/.test(error.message)); assert.equal(f.requests.length, 1);
  }
});
test('save payload snapshots survive a delayed session lookup without acquiring edited identity or fields', async () => {
  const pending = later(), draft = {name: 'Captured Host', phone: ''}, f = fixture({auth: async n => n === 1 ? pending.promise : session('A')});
  const work = f.run({profile: draft}); draft.name = 'Changed Name'; draft.phone = '6045550100'; pending.resolve(session('A')); await work;
  assert.deepEqual(JSON.parse(f.requests[0].body), {name: 'Captured Host', phone: ''});
});
