import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transform} from 'esbuild';

const source = readFileSync(process.env.QA_HELP_SOURCE || new URL('../src/App.jsx', import.meta.url), 'utf8');
const name = source.includes('function ParkerHelp(') ? 'ParkerHelp' : 'FloatingParkerHelp';
const start = source.indexOf('function ' + name + '(');
const built = await transform(source.slice(start, source.indexOf('// ─── Footer', start)), {loader: 'jsx'});
const topics = [{q: 'Synthetic parking question', a: 'Synthetic parking answer'}, {q: 'Synthetic Host question', a: 'Synthetic Host answer'}];
function nodes(node, predicate) {
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => nodes(child, predicate))];
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join('') : '';
}
function harness() {
  const slots = [], effects = [], dom = new Map(); let cursor = 0, tree, active, help = 0, contact = 0;
  const values = {React, C: {}, PARKER: {icon: '/parker/parker-icon.png'}, HELP_TOPICS: topics,
    useState(initial) { const i = cursor++; slots[i] ??= {value: initial}; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useId() { cursor++; return 'synthetic-help-panel'; },
    useRef(initial) { const i = cursor++; return slots[i] ??= {current: initial}; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, j) => v !== old[j])) effects.push(fn); slots[i] = deps; }};
  const Component = new Function(...Object.keys(values), built.code + ';return ' + name + ';')(...Object.values(values));
  function render() {
    cursor = 0; tree = Component({onHelpClick: () => help++, onContactClick: () => contact++});
    for (const node of nodes(tree, n => n.ref)) {
      const key = node.props['aria-label'] || text(node);
      if (!dom.has(key)) dom.set(key, {key, focus() { active = this; }});
      if (typeof node.ref === 'function') node.ref(dom.get(key)); else node.ref.current = dom.get(key);
    }
    for (const effect of effects.splice(0)) effect();
    return tree;
  }
  const find = predicate => { const result = nodes(render(), predicate)[0]; assert.ok(result, 'control exists'); return result; };
  const button = label => find(n => n.type === 'button' && (n.props['aria-label'] === label || text(n) === label));
  const click = label => { button(label).props.onClick(); render(); };
  render(); return {render, button, click, find, get active() { return active?.key; }, get help() { return help; }, get contact() { return contact; }};
}

test('BUG-005449 collapsed and expanded Parker help reserve document space instead of covering map/list/review actions', () => {
  const h = harness();
  for (const open of [false, true]) {
    if (open) h.click('ParkShare help');
    const root = h.render();
    assert.ok(!['fixed', 'absolute', 'sticky'].includes(root.props.style.position));
    assert.equal(root.props.style.width, '100%');
    assert.equal(root.props.style.boxSizing, 'border-box');
    assert.equal(root.props.style.gridTemplateColumns, 'minmax(0, 1fr) 60px');
    const trigger = h.button('ParkShare help');
    assert.equal(trigger.props.onPointerDown, undefined, 'no drag offset can move help back over page actions');
    assert.equal(trigger.props.style.touchAction, 'manipulation');
    if (open) {
      const panel = h.find(n => n.props.role === 'region');
      assert.ok(!['fixed', 'absolute', 'sticky'].includes(panel.props.style.position));
      assert.equal(panel.props.style.gridColumn, '1 / -1');
      assert.equal(panel.props.style.width, '100%');
      assert.equal(panel.props.style.minWidth, 0);
    }
  }
});

test('Parker remains a named disclosure with its approved artwork and ordinary keyboard order', () => {
  const h = harness(), closed = h.button('ParkShare help');
  assert.equal(closed.props['aria-expanded'], false);
  assert.equal(closed.props.type, 'button');
  assert.equal(nodes(h.render(), n => n.props.role === 'region').length, 0);
  assert.ok(React.Children.toArray(h.render().props.children).some(n => n.props?.['aria-label'] === 'ParkShare help'), 'preserves direct-child branding selector');
  h.click('ParkShare help');
  assert.equal(h.button('ParkShare help').props['aria-expanded'], true);
  assert.equal(h.find(n => n.props.role === 'region').props.id, closed.props['aria-controls']);
  assert.equal(h.find(n => n.type === 'img' && n.props.alt === 'Parker').props.src, '/parker/parker-icon.png');
  let prevented = false; h.render().props.onKeyDown({key: 'Tab', preventDefault() { prevented = true; }});
  assert.equal(prevented, false, 'inline help is not a modal or a focus trap');
});

test('all FAQ answers and return-to-topic focus survive the change from floating overlay to page section', () => {
  const h = harness(); h.click('ParkShare help');
  for (const topic of topics) {
    h.click(topic.q);
    assert.ok(text(h.render()).includes(topic.a));
    assert.equal(h.active, '← Back to topics');
    h.click('← Back to topics');
    assert.equal(h.active, topic.q);
    assert.ok(text(h.render()).includes(topics[0].q));
  }
});

test('Help and Contact retain their original page callbacks', () => {
  const h = harness(); h.click('ParkShare help'); h.click('View all Help & FAQ →');
  h.click(topics[0].q); h.click('Still need help? Contact Us →'); h.click('View all Help & FAQ →');
  assert.equal(h.help, 2); assert.equal(h.contact, 1);
});

test('close, toggle and Escape reset the answer and return focus to Parker', () => {
  for (const mode of ['close', 'toggle', 'Escape']) {
    const h = harness(); h.click('ParkShare help'); h.click(topics[1].q);
    if (mode === 'Escape') { let prevented = false; h.render().props.onKeyDown({key: 'Escape', preventDefault() { prevented = true; }}); assert.equal(prevented, true); h.render(); }
    else h.click(mode === 'close' ? 'Close Parker help' : 'ParkShare help');
    assert.equal(h.button('ParkShare help').props['aria-expanded'], false);
    assert.equal(h.active, 'ParkShare help');
    h.click('ParkShare help'); assert.ok(text(h.render()).includes(topics[0].q)); assert.ok(!text(h.render()).includes(topics[1].a));
  }
});

test('inline help is inside the app main landmark, before the footer', () => {
  const caller = source.lastIndexOf('<ParkerHelp onHelpClick=');
  assert.ok(caller > source.lastIndexOf('<main id="main-content"'));
  assert.ok(caller < source.lastIndexOf('</main>'));
  assert.ok(source.indexOf('<HomeFooter', caller) > source.lastIndexOf('</main>'));
});
