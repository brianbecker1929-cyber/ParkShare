import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transform} from 'esbuild';
import {hasNavigationDestination} from '../src/lib/navigation.js';

const source = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const built = await transform(source.slice(source.indexOf('function Modal('), source.indexOf('function RidesharePickupCard(')), {loader: 'jsx'});

function harness({nativeModal = true, connected = true} = {}) {
  const effects = [], restores = [];
  const opener = {isConnected: connected, focus: options => restores.push(options)};
  const document = {activeElement: opener};
  const panel = {ownerDocument: document, shows: 0, closes: 0,
    showModal() { this.shows++; }, close() { this.closes++; },
    querySelectorAll(selector) {
      assert.equal(selector, 'button:not(:disabled)');
      return this.controls.filter(button => !button.disabled);
    }, controls: []};
  const values = {React, C: {}, useRef: () => ({current: panel}), useLayoutEffect: effect => effects.push(effect),
    getAvailableNavigationProviders: () => [{id: 'waze', label: 'Waze'}, {id: 'google', label: 'Google Maps'}], hasNavigationDestination};
  const {Modal, NavigationChooser} = new Function(...Object.keys(values), built.code + ';return {Modal, NavigationChooser};')(...Object.values(values));
  let dismissed = 0;
  const onClose = () => dismissed++;
  const node = Modal({nativeModal, title: 'Preview route to parking', onClose, children: 'Route content'});
  function button(name, disabled = false) {
    const item = {name, disabled, focus() { document.activeElement = item; }};
    return item;
  }
  panel.controls = [button('Close'), button('Waze'), button('Google'), button('Cancel')];
  function key(active, {key = 'Tab', shiftKey = false} = {}) {
    document.activeElement = active;
    const event = {key, shiftKey, currentTarget: panel, prevented: false, preventDefault() { this.prevented = true; }};
    node.props.onKeyDown(event);
    return event;
  }
  return {node, panel, document, opener, restores, effects, key, NavigationChooser, Modal, onClose, get dismissed() { return dismissed; }};
}

function elements(node, predicate) {
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => elements(child, predicate))];
}

test('BUG-005439 preview, exact directions and unavailable-location chooser all use the native modal', () => {
  const h = harness();
  for (const mode of ['preview', 'navigate']) {
    for (const coordinates of [{lat: 43.7, lng: -79.4}, {lat: null, lng: null}]) {
      const chooser = h.NavigationChooser({request: {mode, listing: {address: 'Approximate area', ...coordinates}}, onClose: h.onClose});
      assert.equal(chooser.type, h.Modal);
      assert.equal(chooser.props.nativeModal, true);
      assert.equal(chooser.props.title, mode === 'preview' ? 'Preview route to parking' : 'Navigate to your parking space');
      assert.equal(elements(chooser, n => n.type === 'button' && n.props.children === 'Cancel')[0].props.onClick, h.onClose);
    }
  }
});

test('native modal opens before paint, preserves an accessible name and restores the connected opener on cleanup', () => {
  const h = harness();
  assert.equal(h.node.type, 'dialog');
  assert.equal(h.node.props['aria-label'], 'Preview route to parking');
  assert.equal(h.node.props.open, undefined, 'showModal, not a nonmodal open attribute, controls activation');
  const cleanup = h.effects[0]();
  assert.equal(h.panel.shows, 1);
  assert.equal(elements(h.node, n => n.type === 'button')[0].props['aria-label'], 'Close Preview route to parking');
  cleanup();
  assert.equal(h.panel.closes, 1);
  assert.deepEqual(h.restores, [{preventScroll: true}]);
  // React StrictMode setup/cleanup replay must not leave a closed chooser.
  h.effects[0]()();
  assert.equal(h.panel.shows, 2);
  assert.equal(h.panel.closes, 2);
});

test('Escape native cancel uses the same scoped dismissal as the visible close control', () => {
  const h = harness();
  let prevented = false;
  h.node.props.onCancel({preventDefault() { prevented = true; }});
  assert.equal(prevented, true, 'React owns removal and invalidates the pending route selection');
  assert.equal(h.dismissed, 1);
  elements(h.node, n => n.type === 'button')[0].props.onClick();
  assert.equal(h.dismissed, 2);
});

test('Tab and Shift+Tab wrap within the route chooser while interior keys keep their normal behavior', () => {
  const h = harness(), [close, waze, google, cancel] = h.panel.controls;
  assert.equal(h.key(cancel).prevented, true);
  assert.equal(h.document.activeElement, close);
  assert.equal(h.key(close, {shiftKey: true}).prevented, true);
  assert.equal(h.document.activeElement, cancel);
  assert.equal(h.key(waze).prevented, false);
  assert.equal(h.document.activeElement, waze);
  assert.equal(h.key(google, {shiftKey: true}).prevented, false);
  assert.equal(h.key(cancel, {key: 'Enter'}).prevented, false);
  assert.equal(h.key(h.panel).prevented, true);
  assert.equal(h.document.activeElement, close);
  assert.equal(h.key(h.panel, {shiftKey: true}).prevented, true);
  assert.equal(h.document.activeElement, cancel);
});

test('unavailable destinations keep only Close and Cancel in the keyboard cycle', () => {
  const h = harness(), [close, waze, google, cancel] = h.panel.controls;
  waze.disabled = google.disabled = true;
  assert.equal(h.key(cancel).prevented, true);
  assert.equal(h.document.activeElement, close);
  assert.equal(h.key(close, {shiftKey: true}).prevented, true);
  assert.equal(h.document.activeElement, cancel);
});

test('cleanup never refocuses a removed opener after navigation or account changes', () => {
  const h = harness({connected: false});
  h.effects[0]()();
  assert.equal(h.panel.closes, 1);
  assert.deepEqual(h.restores, []);
});

test('other shared modal callers retain their existing rendering and do not activate a native dialog', () => {
  const h = harness({nativeModal: false});
  assert.equal(h.node.type, 'div');
  assert.equal(elements(h.node, n => n.props.role === 'dialog').length, 1);
  assert.equal(h.effects[0](), undefined);
  assert.equal(h.panel.shows, 0);
  assert.equal(h.panel.closes, 0);
});
