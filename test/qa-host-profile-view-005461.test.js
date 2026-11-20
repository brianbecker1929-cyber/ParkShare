import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {validateHostProfile} from '../src/lib/hostProfile.js';
const source = await readFile(new URL('../src/components/HostProfileView.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.slice(source.indexOf('export default function')).replace('export default ', ''), {loader: 'jsx'})).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
const later = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
const user = (id = 'A', role = 'host') => ({id, role});
const profile = (id = 'A') => ({id, name: id + ' Host', phone: id === 'A' ? '4165550100' : '6045550100', email: id.toLowerCase() + '@example.invalid'});
function nodes(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (predicate(node)) out.push(node);
  React.Children.forEach(node.props?.children, child => nodes(child, predicate, out)); return out;
}
function harness({request = async options => options.profile ? {...profile(options.accountId), ...options.profile} : profile(options.accountId), initialUser = user()} = {}) {
  const slots = [], effects = [], setups = [], calls = [], updates = [], focused = [];
  let cursor = 0, dirty = false, writes = 0, tree, props = {user: initialUser, client: {}, onProfileUpdated: value => updates.push(value)};
  const values = {React, validateHostProfile, AbortController,
    requestHostProfile: async (_client, options) => {calls.push(options); return request(options, calls.length);},
    useRef: initial => {const index = cursor++; return slots[index] || (slots[index] = {current: initial});},
    useState: initial => {const index = cursor++; if (!(index in slots)) slots[index] = {value: initial}; return [slots[index].value, value => {writes++; slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; dirty = true;}];},
    useEffect: (setup, deps) => {const index = cursor++, old = slots[index]; if (!old || deps.some((v, i) => v !== old.deps[i])) {slots[index] = {deps, cleanup: old?.cleanup}; effects.push(() => {slots[index].cleanup?.(); setups[index] = setup; slots[index].cleanup = setup();});}},
  };
  const Component = new Function(...Object.keys(values), compiled + ';return HostProfileView;')(...Object.values(values));
  const render = changes => {props = {...props, ...changes}; let n = 0; do {dirty = false; cursor = 0; tree = Component(props); effects.splice(0).forEach(fn => fn()); assert.ok(++n < 10);} while (dirty); return tree;};
  const find = predicate => {const element = nodes(render(), predicate)[0]; assert.ok(element, 'control exists'); return element;};
  const input = (field, value) => find(n => n.props?.id === 'host-profile-' + field).props.onChange({target: {value}});
  const save = () => find(n => n.type === 'form').props.onSubmit({preventDefault() {}});
  const stop = () => slots.forEach(slot => slot?.cleanup?.());
  render();
  return {render, find, input, save, stop, calls, updates, focused, get writes() {return writes;}, get html() {return renderToStaticMarkup(render());},
    ready: async () => {await tick(); render();},
    reload: () => find(n => n.type === 'button' && n.props.children === 'Reload profile').props.onClick(),
    attachRefs() {for (const n of nodes(render(), n => n.type === 'input' && n.ref)) n.ref.current = {focus: () => focused.push(n.props.id)};},
    replay() {for (const [index, setup] of setups.entries()) if (setup) {slots[index].cleanup?.(); slots[index].cleanup = setup();} render();},
  };
}

test('BUG-005461 the real Host form loads canonical details, shows a read-only email and labels every field', async () => {
  const pending = later(), h = harness({request: () => pending.promise});
  assert.match(h.html, /Loading your Host profile/); assert.doesNotMatch(h.html, /host-profile-name|a@example.invalid/);
  pending.resolve(profile()); await h.ready();
  assert.match(h.html, /Your Host profile/); assert.match(h.html, /A Host/);
  for (const field of ['name', 'email', 'phone']) assert.ok(nodes(h.render(), n => n.type === 'label' && n.props.htmlFor === 'host-profile-' + field).length);
  const email = h.find(n => n.props?.id === 'host-profile-email'); assert.equal(email.props.readOnly, true); assert.equal(email.props.onChange, undefined);
  assert.equal(h.find(n => n.type === 'form').props.noValidate, true); assert.doesNotMatch(h.html, /license plate|vehicle make|Driver profile/); h.stop();
});

test('invalid name and phone values focus their associated fields and never start a save', async () => {
  const h = harness(); await h.ready(); h.attachRefs(); h.input('name', 'A'); await h.save();
  assert.equal(h.calls.length, 1); assert.equal(h.focused.at(-1), 'host-profile-name');
  assert.equal(h.find(n => n.props?.id === 'host-profile-name').props['aria-describedby'], 'host-profile-name-error');
  h.input('name', 'Valid Host'); h.input('phone', '123'); await h.save();
  assert.equal(h.calls.length, 1); assert.equal(h.focused.at(-1), 'host-profile-phone'); assert.match(h.html, /complete phone number/); h.stop();
});

test('pending saves suppress duplicate callbacks and draft changes, then publish one canonical confirmation', async () => {
  const pending = later(), h = harness({request: async options => options.profile ? pending.promise : profile()}); await h.ready();
  h.input('name', ' Saved Host '); const submit = h.find(n => n.type === 'form').props.onSubmit;
  const first = submit({preventDefault() {}}), second = submit({preventDefault() {}});
  h.input('name', 'Changed while pending'); assert.equal(h.calls.filter(c => c.profile).length, 1);
  assert.equal(h.find(n => n.props?.id === 'host-profile-name').props.disabled, true); assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Reload profile').props.disabled, true);
  assert.equal(h.calls.at(-1).profile.name, 'Saved Host');
  pending.resolve({...profile(), name: 'Saved Host'}); await Promise.all([first, second]);
  assert.match(h.html, /Profile saved successfully/); assert.equal(h.updates.length, 2); assert.equal(h.updates.at(-1).name, 'Saved Host'); h.stop();
});

test('a failed/partial save never reports success and explicit reload shows the confirmed backend state', async () => {
  let stored = profile(), saves = 0;
  const h = harness({request: async options => {if (!options.profile) return {...stored}; saves++; stored = {...stored, name: options.profile.name}; throw Error("Couldn't confirm the save. Reload the profile.");}});
  await h.ready(); h.input('name', 'Partly Saved Host'); h.input('phone', '9055550100'); await h.save();
  assert.equal(saves, 1); assert.equal(h.updates.length, 1); assert.doesNotMatch(h.html, /Profile saved successfully/); assert.match(h.html, /Reload the profile/);
  h.reload(); await h.ready(); assert.equal(h.find(n => n.props?.id === 'host-profile-name').props.value, 'Partly Saved Host'); assert.equal(h.find(n => n.props?.id === 'host-profile-phone').props.value, '4165550100'); assert.equal(h.updates.at(-1).name, 'Partly Saved Host'); h.stop();
});

test('late reads never expose another account and stale A-to-B-to-A saves cannot publish', async () => {
  const delayedRead = later(), h = harness({request: async (options, count) => count === 1 ? delayedRead.promise : profile(options.accountId)});
  h.render({user: user('B')}); assert.doesNotMatch(h.html, /A Host|4165550100/); await h.ready();
  delayedRead.resolve(profile('A')); await h.ready(); assert.match(h.html, /B Host/); assert.doesNotMatch(h.html, /A Host|4165550100/); h.stop();
  const delayedSave = later(), f = harness({request: async options => options.profile ? delayedSave.promise : profile(options.accountId)}); await f.ready();
  f.input('name', 'Obsolete Save'); const work = f.save(); f.render({user: user('B')}); await f.ready(); f.render({user: user('A')}); await f.ready();
  const writes = f.writes, publications = f.updates.length; delayedSave.resolve({...profile(), name: 'Obsolete Save'}); await work;
  assert.equal(f.writes, writes); assert.equal(f.updates.length, publications); assert.doesNotMatch(f.html, /Obsolete Save|Profile saved successfully/); f.stop();
});

test('unmount and StrictMode replay retire old reads/save replies and leave a fresh profile usable', async () => {
  const read = later(), h = harness({request: async (_options, count) => count === 1 ? read.promise : profile()});
  h.replay(); await h.ready(); const n = h.writes; read.resolve({...profile(), name: 'Obsolete Read'}); await h.ready(); assert.equal(h.writes, n); assert.doesNotMatch(h.html, /Obsolete Read/); h.stop();
  for (const failure of [false, true]) {
    const pending = later(), f = harness({request: async options => options.profile ? pending.promise : profile()}); await f.ready(); const work = f.save(); f.stop(); const writes = f.writes;
    if (failure) pending.reject(Error('Obsolete error')); else pending.resolve(profile()); await work;
    assert.equal(f.writes, writes); assert.equal(f.updates.length, 1);
  }
});

test('a failed initial read has an explicit reload path, while a non-Host component cannot read the endpoint', async () => {
  const h = harness({request: async (_options, count) => {if (count === 1) throw Error('Profile unavailable'); return profile();}}); await h.ready();
  assert.match(h.html, /Profile unavailable/); assert.doesNotMatch(h.html, /host-profile-name/); h.reload(); await h.ready(); assert.match(h.html, /A Host/); h.stop();
  const f = harness({initialUser: user('A', 'driver')}); await f.ready(); assert.equal(f.calls.length, 0); assert.match(f.html, /Sign in as a Host/); f.stop();
});

test('Host Profile navigation and the real root callback preserve identity/role isolation', async () => {
  const app = await readFile(process.env.QA_HOST_PROFILE_APP || new URL('../src/App.jsx', import.meta.url), 'utf8');
  const start = app.indexOf('  const tabs =', app.indexOf('function Header(')), end = app.indexOf('  // The compact', start);
  const tabs = new Function('user', app.slice(start, end) + ';return tabs;');
  assert.ok(tabs(user()).includes('Profile')); assert.ok(tabs(user('A', 'driver')).includes('Profile'));
  const tag = app.match(/<HostProfileView\b[\s\S]*?\/>/)[0], built = await transform('function Parent(){return ' + tag + ';}', {loader: 'jsx'});
  let update;
  const element = new Function('React', 'HostProfileView', 'user', 'supabase', 'setUser', built.code + ';return Parent();')(React, () => null, user(), {}, fn => {update = fn;});
  assert.equal(element.key, 'A'); element.props.onProfileUpdated(profile());
  assert.deepEqual(update(user()), {...user(), ...profile()}); assert.equal(update(null), null);
  const other = user('B'), driver = user('A', 'driver'); assert.equal(update(other), other); assert.equal(update(driver), driver);
  assert.match(app, /tab === "Profile" && user\?\.role === "host" && <HostProfileView/);
  assert.match(app, /tab === "Profile" && user\?\.role !== "host" && requireDriver/);
});
