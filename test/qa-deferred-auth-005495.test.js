import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import React from 'react';
import {createAuthValidationLoader} from '../src/lib/authValidation.js';
import {updateRecoveryPasswordForAccount} from '../src/lib/passwordRecovery.js';

const later = () => { let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const rules = {validateAuthForm: (form, screen) => ({form, screen}), validateNewPassword: password => password === 'weak' ? 'Rejected' : null};

test('BUG-005495 the validator loads only on demand, coalesces callers and fails closed before loading', async () => {
  const pending = later(); let calls = 0;
  const loader = createAuthValidationLoader(() => {calls++; return pending.promise;});
  assert.equal(calls, 0);
  assert.throws(() => loader.validateNewPassword('weak'), /not ready/);
  const first = loader.load(), second = loader.load();
  assert.equal(first, second); await tick(); assert.equal(calls, 1);
  assert.throws(() => loader.validateAuthForm({}, 'signup'), /not ready/);
  pending.resolve(rules); assert.equal(await first, rules);
  assert.equal(loader.validateNewPassword('weak'), 'Rejected');
  assert.deepEqual(loader.validateAuthForm({name: 'Synthetic'}, 'signup'), {form: {name: 'Synthetic'}, screen: 'signup'});
  await loader.load(); assert.equal(calls, 1);
});

test('failed or malformed validator loads cannot authorize a form and explicit retry can recover', async () => {
  for (const malformed of [false, true]) {
    let calls = 0;
    const loader = createAuthValidationLoader(async () => {if (++calls > 1) return rules; if (malformed) return {}; throw Error('Synthetic chunk failure');});
    await assert.rejects(loader.load());
    assert.throws(() => loader.validateNewPassword('weak'), /not ready/);
    assert.equal(await loader.load(), rules); assert.equal(calls, 2);
    assert.equal(loader.validateNewPassword('weak'), 'Rejected');
  }
});

const source = await readFile(new URL('../src/components/DeferredAuth.jsx', import.meta.url), 'utf8');
const compiled = (await transform(source.slice(source.indexOf('export default function')).replace('export default ', ''), {loader: 'jsx'})).code;
function harness(load) {
  const slots = [], effects = []; let cursor = 0, tree, closeCount = 0, writes = 0, effectSetup;
  const Dialog = () => null, child = React.createElement('account-form', {onClose: () => closeCount++});
  const Component = new Function('React', 'useState', 'useEffect', 'loadAuthValidation', compiled + ';return DeferredAuth;')(
    React,
    initial => {const index = cursor++; slots[index] ??= {value: initial}; return [slots[index].value, value => {writes++; slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;}];},
    (setup, deps) => {const index = cursor++, old = slots[index]; if (!old || deps.some((v, i) => v !== old.deps[i])) {slots[index] = {deps, cleanup: old?.cleanup}; effects.push(() => {slots[index].cleanup?.(); effectSetup = setup; slots[index].cleanup = setup();});}}, load);
  const render = () => {cursor = 0; tree = Component({Dialog, children: child}); effects.splice(0).forEach(fn => fn()); return tree;};
  const stop = () => slots.forEach(slot => slot?.cleanup?.());
  const buttons = node => React.Children.toArray(node?.props?.children).flatMap(child => child?.type === 'button' ? [child] : child?.props ? buttons(child) : []);
  return {render, stop, child, Dialog, buttons, get writes() {return writes;}, get closed() {return closeCount;}, replay() {stop(); const cleanup = effectSetup(); slots.find(slot => slot?.cleanup).cleanup = cleanup;}};
}

test('the real loading gate withholds account controls, exposes status and preserves Close', async () => {
  const pending = later(), h = harness(() => pending.promise), loading = h.render();
  assert.equal(loading.type, h.Dialog); assert.equal(loading.props.title, 'Loading ParkShare account');
  assert.ok(React.Children.toArray(loading.props.children).some(node => node.props?.role === 'status'));
  assert.ok(h.buttons(loading).every(button => button.props.type === 'button'));
  h.buttons(loading)[0].props.onClick(); assert.equal(h.closed, 1); h.stop();
  const writes = h.writes; pending.resolve(rules); await tick(); assert.equal(h.writes, writes);
});

test('the real gate admits the original child only on success and provides a generic failure/retry path', async () => {
  let calls = 0;
  const h = harness(async () => {if (++calls === 1) throw Error('PRIVATE provider error'); return rules;});
  h.render(); await tick(); const failed = h.render();
  assert.ok(React.Children.toArray(failed.props.children).some(node => node.props?.role === 'alert'));
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE provider error/);
  const retry = h.buttons(failed).find(node => node.props.children === 'Retry account form');
  assert.ok(retry); retry.props.onClick(); h.render(); await tick();
  assert.equal(h.render(), h.child); assert.equal(calls, 2); h.stop();
});

test('StrictMode replay and unmount retire old load completions without mounting a stale form', async () => {
  const first = later(), second = later(); let calls = 0;
  const h = harness(() => ++calls === 1 ? first.promise : second.promise);
  h.render(); h.replay(); const writes = h.writes;
  first.resolve(rules); await tick(); assert.equal(h.writes, writes);
  second.resolve(rules); await tick(); assert.equal(h.render(), h.child); h.stop();
  const failure = later(), closed = harness(() => failure.promise); closed.render(); closed.stop(); const n = closed.writes;
  failure.reject(Error('Obsolete load')); await tick(); assert.equal(closed.writes, n);
});

test('a recovery attempt retired while validation loads cannot read a session or write a password', async () => {
  let active = true, reads = 0, writes = 0;
  const work = updateRecoveryPasswordForAccount({expectedAccountId: 'A', password: 'pebble lantern orbit marigold', isCurrent: () => active,
    client: {auth: {getSession: async () => {reads++; throw Error('must not read');}}}, request: async () => {writes++; throw Error('must not write');}});
  active = false; assert.equal(await work, null); assert.equal(reads, 0); assert.equal(writes, 0);
});
