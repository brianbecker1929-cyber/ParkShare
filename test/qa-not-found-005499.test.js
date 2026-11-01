import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';

const root = new URL('../', import.meta.url);
const routes = await import(process.env.QA_ROUTES_SOURCE || new URL('src/lib/routes.js', root));
const {PARKSHARE_ROUTES, getRouteFromPath, getRouteForState, updateRouteMetadata} = routes;
const config = JSON.parse(readFileSync(process.env.QA_ROUTING_CONFIG || new URL('vercel.json', root), 'utf8'));
const document404 = readFileSync(new URL('public/404.html', root), 'utf8');
const app = readFileSync(process.env.QA_NOT_FOUND_APP || new URL('src/App.jsx', root), 'utf8');

function fakeDocument() {
  const elements = [];
  const matches = (node, selector) => selector === 'link[rel="canonical"]' ? node.tag === 'link' && node.attrs.rel === 'canonical'
    : node.tag === 'meta' && (selector.includes('name=') ? selector === `meta[name="${node.attrs.name}"]` : selector === `meta[property="${node.attrs.property}"]`);
  return {title: '', head: {querySelector(selector) { return elements.find(n => !n.removed && matches(n, selector)) || null; }, appendChild(node) { elements.push(node); }},
    createElement(tag) { return {tag, attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, remove() { this.removed = true; }}; }};
}

test('BUG-005499 unknown page, missing file and nested lookalike URLs resolve to Not Found rather than landing', () => {
  for (const path of ['/this-page-does-not-exist', '/llms.txt', '/parking/not-a-page', '/privacy/anything', '/missing.js', '/api/not-an-endpoint']) {
    const route = getRouteFromPath(path); assert.equal(route.screen, 'not-found', path); assert.equal(route.notFound, true); assert.equal(route.path, null);
  }
  assert.equal(getRouteForState('not-found').notFound, true);
});

test('all real app pages and return-link query strings retain their route; aliases are preserved', () => {
  for (const route of PARKSHARE_ROUTES) {
    for (const path of [route.path, route.path + (route.path === '/' ? '' : '/'), route.path + '?qa_probe=1#section']) assert.equal(getRouteFromPath(path).path, route.path);
  }
  assert.equal(getRouteFromPath('/discover/events').path, '/discover/festivals');
  assert.equal(getRouteFromPath('/index.html').screen, 'landing');
  assert.equal(getRouteFromPath('/?extend_booking=synthetic').screen, 'landing');
  assert.equal(getRouteFromPath('/parking?message_booking=synthetic').tab, 'Browse');
});

test('Vercel serves the SPA only for known routes, including trailing slashes; unknown files/API paths cannot match it', () => {
  const appSources = config.rewrites.filter(r => r.destination === '/index.html').map(r => r.source);
  const expected = PARKSHARE_ROUTES.flatMap(r => r.path === '/' ? ['/'] : [r.path, r.path + '/']);
  assert.deepEqual(new Set(appSources), new Set(expected));
  assert.equal(appSources.length, new Set(appSources).size);
  assert.ok(appSources.every(path => !/[()*?:]/.test(path)), 'no catch-all can convert unknown addresses into 200 homepage responses');
  for (const missing of ['/this-page-does-not-exist', '/llms.txt', '/assets/missing.js', '/api/qa-release-status', '/robots.txt', '/sitemap.xml']) assert.ok(!appSources.includes(missing));
  for (const source of ['/discover/events', '/discover/events/']) assert.ok(config.redirects.some(r => r.source === source && r.destination === '/discover/festivals' && r.permanent === true));
});

test('standalone 404 page is available without JavaScript, excludes indexing and links to real destinations', () => {
  assert.match(document404, /<title>Page not found \| ParkShare<\/title>/);
  assert.match(document404, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(document404, /<h1>Page not found<\/h1>/);
  assert.match(document404, /href="\/parking">Find Parking<\/a>/);
  assert.match(document404, /href="\/">Home<\/a>/);
  assert.doesNotMatch(document404, /<script|rel="canonical"|id="root"/);
  assert.ok(existsSync(new URL('public/brand/parkshare-william-parker-logo.webp', root)));
});

test('client Not Found removes homepage canonical/social URL and indexing; known routes restore valid metadata', t => {
  const previous = globalThis.document; const doc = fakeDocument(); globalThis.document = doc;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  updateRouteMetadata(getRouteFromPath('/'));
  assert.equal(doc.head.querySelector('link[rel="canonical"]').attrs.href, 'https://www.myparkshare.ca/');
  updateRouteMetadata(getRouteFromPath('/missing'));
  assert.equal(doc.title, 'Page not found | ParkShare');
  assert.equal(doc.head.querySelector('meta[name="robots"]').attrs.content, 'noindex, nofollow');
  assert.equal(doc.head.querySelector('link[rel="canonical"]'), null);
  assert.equal(doc.head.querySelector('meta[property="og:url"]'), null);
  updateRouteMetadata(getRouteFromPath('/parking'));
  assert.equal(doc.head.querySelector('link[rel="canonical"]').attrs.href, 'https://www.myparkshare.ca/parking');
  assert.equal(doc.head.querySelector('meta[property="og:url"]').attrs.content, 'https://www.myparkshare.ca/parking');
  assert.equal(doc.head.querySelector('meta[name="robots"]').attrs.content, 'index, follow');
  updateRouteMetadata(getRouteFromPath('/my-bookings'));
  assert.equal(doc.head.querySelector('meta[name="robots"]').attrs.content, 'noindex, nofollow');
});

test('the client catch-all renders a named main landmark and real recovery links before the landing branch', async () => {
  const start = app.indexOf('function NotFoundPage('); assert.ok(start >= 0);
  const built = await transform(app.slice(start, app.indexOf('function LandingPage(', start)), {loader: 'jsx'});
  const Page = new Function('React', 'C', built.code + ';return NotFoundPage;')(React, {navy: '#0E1B2E', warmWhite: '#FAF7F0', amber: '#FFC107'});
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.match(html, /<main id="main-content"/); assert.match(html, /<h1>Page not found<\/h1>/); assert.match(html, /href="\/parking"/); assert.match(html, /href="\/"/);
  assert.match(app, /screen === "not-found" \? <NotFoundPage \/> : screen === "landing"/);
});
