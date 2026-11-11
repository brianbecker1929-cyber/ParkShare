import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {GoogleMap as ProviderGoogleMap} from '@react-google-maps/api';
import {transform} from 'esbuild';
import {satelliteSpotPoint, satelliteSpotBounds} from '../src/lib/satelliteSpotDrawing.js';
import {getListingSpotLayout} from '../src/lib/listingSpotLayout.js';
import {hostListingRow} from '../api/_host-listing.js';
import {createAvailabilityPreset} from '../src/lib/listingAvailability.js';

const source = readFileSync(process.env.QA_SATELLITE_SOURCE || new URL('../src/App.jsx', import.meta.url), 'utf8');
const start = source.indexOf('function DrivewaySpotSatelliteMap(');
const built = await transform(source.slice(start, source.indexOf('// ─── List Driveway', start)), {loader: 'jsx', define: {'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': 'MAP_KEY'}});
const center = {lat: 43.8, lng: -79.5}, first = {lat: 43.80001, lng: -79.50002}, second = {lat: 43.80006, lng: -79.49998};
const latLng = point => ({lat: () => point.lat, lng: () => point.lng});
function nodes(node, predicate) {
  if (!React.isValidElement(node)) return [];
  return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => nodes(child, predicate))];
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join('') : '';
}
function harness({spots = [], loaded = true, loadError = null, key = 'synthetic-map-key'} = {}) {
  const slots = [], effects = [], saved = [], toggled = [], removed = [], loader = [];
  let cursor = 0, tree, dirty, focused = 0, currentCenter = center, stateWrites = 0, previewAttached = false;
  const previewOverlay = {bounds: null, setBounds(bounds) { this.bounds = bounds; }};
  const trigger = {focus() { focused++; }};
  function GoogleMap() {} function Rectangle() {} function Marker() {} function OverlayView() {}
  OverlayView.OVERLAY_MOUSE_TARGET = 'synthetic-pane';
  // Mirror the provider's removal: the namespace and DrawingManager are unavailable.
  function DrawingManager() { throw Error('DrawingManager is no longer available as of version 3.65'); }
  const values = {React, GoogleMap, Rectangle, Marker, OverlayView, DrawingManager, window: {google: {maps: {}}},
    C: {}, SPOT_STROKE_RENT: '#3F7A5E', SPOT_STROKE_PRIVATE: '#0E1B2E', satelliteSpotPoint, satelliteSpotBounds,
    MAP_KEY: key, GOOGLE_MAPS_LIBRARIES: ['places'], useJsApiLoader(opts) { loader.push(opts); return {isLoaded: loaded, loadError}; },
    useState(initial) { const i = cursor++; slots[i] ??= {value: initial}; return [slots[i].value, value => { const next = typeof value === 'function' ? value(slots[i].value) : value; if (next !== slots[i].value) { slots[i].value = next; dirty = true; stateWrites++; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= {current: initial}; },
    useId() { cursor++; return 'synthetic-drawing-instructions'; },
    useMemo(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) slots[i] = {value: fn(), deps}; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) { slots[i] = {deps}; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } }};
  const Component = new Function(...Object.keys(values), built.code + ';return DrivewaySpotSatelliteMap;')(...Object.values(values));
  const props = {center, spots, maxSpots: 8, onAddSpot(bounds) { saved.push(bounds); props.spots = [...props.spots, {id: 'new-' + saved.length, forRent: true, bounds}]; }, onToggleSpot: id => toggled.push(id), onRemoveSpot: id => removed.push(id)};
  function render() {
    let count = 0;
    do {
      dirty = false; cursor = 0; tree = Component(props);
      for (const node of nodes(tree, n => n.type === DrawingManager)) node.type(node.props);
      for (const node of nodes(tree, n => n.type === 'button' && n.ref)) node.ref.current = trigger;
      const preview = nodes(tree, n => n.type === Rectangle && n.props.onLoad)[0];
      if (preview && !previewAttached) { previewOverlay.bounds = preview.props.bounds; preview.props.onLoad(previewOverlay); }
      previewAttached = Boolean(preview);
      for (const effect of effects.splice(0)) effect();
      assert.ok(++count < 6, 'finite render cycle');
    } while (dirty);
    return tree;
  }
  const find = predicate => { const result = nodes(render(), predicate)[0]; assert.ok(result, 'control exists'); return result; };
  const map = () => find(n => n.type === GoogleMap);
  const button = label => find(n => n.type === 'button' && (n.props['aria-label'] === label || text(n) === label));
  const startDrawing = () => { find(n => n.type === 'button' && n.props['aria-pressed'] !== undefined).props.onClick(); render(); };
  const click = point => { map().props.onClick({latLng: point == null ? null : latLng(point)}); render(); };
  render();
  if (nodes(tree, n => n.type === GoogleMap).length) map().props.onLoad({getCenter: () => latLng(currentCenter)});
  return {render, find, map, button, startDrawing, click, saved, toggled, removed, props, loader, Rectangle, Marker,
    move(point) { map().props.onMouseMove({latLng: latLng(point)}); },
    get previewBounds() { return previewOverlay.bounds; }, get stateWrites() { return stateWrites; },
    mapCenter(point) { currentCenter = point; }, get focused() { return focused; },
    stop() { for (const slot of slots) slot?.cleanup?.(); }};
}

test('BUG-005451 satellite map mounts without the removed Google drawing namespace', () => {
  const h = harness();
  assert.equal(h.map().props.mapTypeId, 'satellite');
  assert.equal(h.map().props.options.mapTypeId, 'satellite');
  assert.equal(h.map().props.options.zoomControl, true);
  assert.equal(h.loader[0].libraries.includes('drawing'), false);
  assert.doesNotMatch(source, /\bDrawingManager\b|google\.maps\.drawing/);
  const libraries = source.match(/const GOOGLE_MAPS_LIBRARIES = (\[[^;]+\]);/)[1];
  assert.deepEqual(JSON.parse(libraries), ['places'], 'all existing map and Places loaders retain one stable library set');
});

test('two map taps and the draft preview produce one persisted rectangle in the existing spot format', () => {
  const h = harness(), camera = h.map().props.center;
  h.startDrawing(); h.click(first);
  assert.equal(h.saved.length, 0); assert.equal(h.find(n => n.type === h.Marker).props.position.lat, first.lat);
  h.move(second); assert.equal(h.saved.length, 0, 'hovering is only a preview');
  assert.deepEqual(h.previewBounds, {north: second.lat, south: first.lat, east: second.lng, west: first.lng});
  assert.equal(h.map().props.center, camera, 'draft renders do not recenter the map');
  const oldClick = h.map().props.onClick;
  oldClick({latLng: latLng(second)}); oldClick({latLng: latLng(second)}); h.render();
  assert.equal(h.saved.length, 1); assert.equal(h.focused, 1);
  assert.deepEqual(h.saved[0], {north: second.lat, south: first.lat, east: second.lng, west: first.lng});
  const layout = getListingSpotLayout({spots: h.props.spots, totalSpots: 1});
  assert.deepEqual(layout, [{index: 0, label: 'A', forRent: true}]);
  assert.deepEqual(h.props.spots[0].bounds, h.saved[0]);
});

test('the installed Maps wrapper constructs its first map with satellite options', () => {
  const h = harness(), oldGoogle = globalThis.google;
  let constructed;
  globalThis.google = {maps: {Map: function(host, options) { constructed = options; }}};
  try {
    const provider = new ProviderGoogleMap(h.map().props);
    provider.getRef({}); provider.getInstance();
    assert.equal(constructed.mapTypeId, 'satellite', 'the provider must not start with default roadmap tiles');
  } finally { if (oldGoogle === undefined) delete globalThis.google; else globalThis.google = oldGoogle; }
});

test('mouse preview moves do not schedule React map updates before the finishing click', () => {
  const h = harness(); h.startDrawing(); h.click(first);
  const writes = h.stateWrites;
  for (let i=0;i<5;i++) h.move(second);
  assert.equal(h.stateWrites, writes);
  h.click(second);
  assert.equal(h.saved.length, 1, 'one finishing click after desktop hover saves once');
});

test('saved map labels stay on one line and disabled remove controls let drawing clicks through', () => {
  const h = harness({spots:[{id:'a',forRent:true,bounds:satelliteSpotBounds(first,second)}]});
  assert.equal(h.find(n=>n.type==='span' && text(n).startsWith('Spot A')).props.style.whiteSpace,'nowrap');
  h.startDrawing();
  assert.equal(h.button('Remove spot A').props.style.pointerEvents,'none');
});

test('actual wizard counter uses marked spots instead of stale fallback selections', async () => {
  const anchor = source.indexOf('maxSpots={8}', source.indexOf('/* Step 4: Spot template */'));
  const from = source.indexOf('<div',anchor), to = source.indexOf('</div>',from)+6;
  const counter = await transform('const counter = form => ('+source.slice(from,to)+');',{loader:'jsx'});
  const View = new Function('React','C',counter.code+';return counter;')(React,{});
  const texts = spots => text(View({spots,selectedSpots:[true,true]}));
  assert.equal(texts([]),'No spots marked yet');
  assert.equal(texts([{forRent:true},{forRent:false}]),'1 of 2 marked spots available for rent');
  const sync = source.match(/const syncSpots = ([^\n]+);/)[1];
  const synced = new Function('return ('+sync+');')()({selectedSpots:[true],totalSpots:1},[]);
  assert.equal(text(View(synced)),'No spots marked yet');
  assert.deepEqual(synced.selectedSpots,[true], 'Skip for now keeps the established manual-layout fallback');
});

test('corners normalize in either direction and invalid, repeated or zero-area corners never save', () => {
  assert.deepEqual(satelliteSpotBounds(second, first), satelliteSpotBounds(first, second));
  for (const invalid of [null, {}, {lat: NaN, lng: -79.5}, {lat: 91, lng: 0}, {lat: '43.8', lng: -79.5}]) assert.equal(satelliteSpotPoint(invalid, center), null);
  assert.equal(satelliteSpotPoint({lat: center.lat + 1, lng: center.lng}, center), null);
  const h = harness(); h.startDrawing(); h.click(null); assert.equal(h.saved.length, 0);
  h.click(first);
  for (const point of [first, {lat: first.lat, lng: second.lng}, {lat: second.lat, lng: first.lng}, {lat: 0, lng: 0}]) { h.click(point); assert.equal(h.saved.length, 0); assert.ok(nodes(h.render(), n => n.props.role === 'alert').length); }
  h.click(second); assert.equal(h.saved.length, 1); assert.equal(nodes(h.render(), n => n.props.role === 'alert').length, 0);
});

test('Cancel and Escape discard partial geometry; stale clicks and leaving the map cannot save', () => {
  for (const mode of ['Cancel', 'Escape', 'unmount']) {
    const h = harness(); h.startDrawing(); h.click(first); const oldClick = h.map().props.onClick;
    if (mode === 'Cancel') h.button('Cancel drawing').props.onClick();
    else if (mode === 'Escape') { let prevented = false; h.render().props.onKeyDown({key: 'Escape', preventDefault() { prevented = true; }}); assert.equal(prevented, true); }
    else h.stop();
    oldClick({latLng: latLng(second)}); assert.equal(h.saved.length, 0);
    if (mode !== 'unmount') { h.render(); h.startDrawing(); h.click(second); assert.equal(h.saved.length, 0, 'new drawing needs a new first corner'); h.click(first); assert.equal(h.saved.length, 1); }
  }
});

test('map-centre controls offer a keyboard alternative and restore focus after completing a spot', () => {
  const h = harness(); h.startDrawing(); h.mapCenter(first);
  assert.equal(h.map().props.options.keyboardShortcuts, true);
  const firstButton = h.button('Set first corner at map centre'); assert.equal(firstButton.props['aria-describedby'], 'synthetic-drawing-instructions');
  firstButton.props.onClick(); h.render(); h.mapCenter(second); h.button('Set opposite corner at map centre').props.onClick(); h.render();
  assert.deepEqual(h.saved, [satelliteSpotBounds(first, second)]); assert.equal(h.focused, 1);
});

test('saved spots remain toggleable and removable; drawing cannot accidentally change a saved spot', () => {
  const h = harness({spots: [{id: 'existing', forRent: true, bounds: satelliteSpotBounds(first, second)}]});
  const oldRectangle = h.find(n => n.type === h.Rectangle), remove = h.button('Remove spot A');
  oldRectangle.props.onClick(); remove.props.onClick(); assert.deepEqual(h.toggled, ['existing']); assert.deepEqual(h.removed, ['existing']);
  h.startDrawing(); oldRectangle.props.onClick(); remove.props.onClick(); assert.equal(h.toggled.length, 1); assert.equal(h.removed.length, 1);
  assert.equal(h.find(n => n.type === h.Rectangle).props.options.clickable, false); assert.equal(h.button('Remove spot A').props.disabled, true);
  h.button('Cancel drawing').props.onClick(); h.render(); h.find(n => n.type === h.Rectangle).props.onClick(); assert.equal(h.toggled.length, 2);
});

test('maximum spots and a changed driveway invalidate a partial drawing immediately, including A-to-B-to-A', () => {
  const h = harness(); h.startDrawing(); h.click(first); const oldClick = h.map().props.onClick;
  h.props.spots = Array.from({length: 8}, (_, i) => ({id: i, forRent: true, bounds: satelliteSpotBounds(first, second)})); h.render();
  oldClick({latLng: latLng(second)}); assert.equal(h.saved.length, 0);
  assert.equal(h.find(n => n.type === 'button' && n.props['aria-pressed'] !== undefined).props.disabled, true);
  h.props.spots = []; h.render(); h.startDrawing(); h.click(first);
  h.props.center = {lat: 44, lng: -79}; h.render(); oldClick({latLng: latLng(second)}); assert.equal(h.saved.length, 0);
  h.props.center = center; h.render(); oldClick({latLng: latLng(second)}); assert.equal(h.saved.length, 0);
  h.startDrawing(); h.click(second); assert.equal(h.saved.length, 0); h.click(first); assert.equal(h.saved.length, 1);
});

test('missing key, pending load and genuine map load failures remain explicit and cannot draw', () => {
  for (const [options, expected] of [[{key: ''}, /missing Google Maps API key/], [{loaded: false}, /Loading satellite imagery/], [{loadError: Error('Synthetic provider outage')}, /Couldn.t load satellite imagery/]]) {
    const h = harness(options); assert.match(text(h.render()), expected); assert.equal(nodes(h.render(), n => n.type === 'button').length, 0); assert.equal(h.saved.length, 0);
  }
});


test('new rectangle bounds satisfy the existing publication validator and retain public/private spot identities', () => {
  const host = '00000000-0000-4000-8000-000000000081', project = 'https://sample.invalid';
  const bounds = satelliteSpotBounds(first, second);
  const row = hostListingRow({title: 'Synthetic driveway', address: '123 Test Street, Toronto ON M5V 2T6', price: 12, description: '', features: [],
    photos: [project + '/storage/v1/object/public/listing-photos/' + host + '/10000000-0000-4000-8000-000000000001.webp'],
    ...center, spots: [{forRent: true, bounds}, {forRent: false, bounds}], availability: createAvailabilityPreset('anytime', 'America/Toronto')}, host, 'America/Toronto', project, new Date('2026-11-01T12:00:00Z'));
  assert.equal(row.spaces, 1); assert.deepEqual(row.spots.map(s => s.bounds), [bounds, bounds]);
  assert.deepEqual(getListingSpotLayout(row), [{index: 0, label: 'A', forRent: true}, {index: 1, label: 'B', forRent: false}]);
});
