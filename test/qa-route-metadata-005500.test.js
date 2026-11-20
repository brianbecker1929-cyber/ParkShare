import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transform} from 'esbuild';
import {PARKSHARE_ROUTES, SITE_ORIGIN, getRouteFromPath, getRouteForState, routeDocumentPath} from '../src/lib/routes.js';
import {renderRouteDocument, renderSitemap, writeRoutePages, routePagesPlugin, SITE_METADATA_UPDATED} from '../scripts/route-pages.mjs';

const root = new URL('../', import.meta.url), template = await readFile(new URL('index.html', root), 'utf8');
const app = await readFile(new URL('src/App.jsx', root), 'utf8');
const body = html => html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1];
const count = (html, pattern) => [...html.matchAll(pattern)].length;

test('BUG-005500 every built route has its own initial title, description, canonical and social metadata', () => {
  for (const route of PARKSHARE_ROUTES) {
    const html = renderRouteDocument(template, route);
    assert.ok(html.includes('<title>' + route.title + '</title>'), route.path);
    for (const tag of [`name="description" content="${route.description}"`, `rel="canonical" href="${SITE_ORIGIN + route.path}"`, `property="og:title" content="${route.title}"`, `property="og:description" content="${route.description}"`, `property="og:url" content="${SITE_ORIGIN + route.path}"`, `name="twitter:title" content="${route.title}"`, `name="twitter:description" content="${route.description}"`]) assert.ok(html.includes(tag), route.path + ': ' + tag);
    assert.equal(count(html, /<title>/g), 1); assert.equal(count(html, /rel="canonical"/g), 1);
    assert.equal(count(html, /property="og:title"/g), 1); assert.equal(count(html, /name="description"/g), 1);
    assert.ok(html.includes('content="' + (route.private ? 'noindex, nofollow' : 'index, follow') + '"'));
    assert.equal(body(html), body(template), 'client boot/return-query behavior is preserved');
    assert.equal(getRouteFromPath(routeDocumentPath(route)).path, route.path);
  }
});

test('metadata escapes values and replaces only the document head, without duplicating tags on repeated builds', () => {
  const route = {...PARKSHARE_ROUTES[0], title: 'A < B & "C"', description: "A 'quoted' <description> & value"};
  const html = renderRouteDocument(template, route);
  assert.ok(html.includes('<title>A &lt; B &amp; &quot;C&quot;</title>'));
  assert.ok(html.includes('A &#39;quoted&#39; &lt;description&gt; &amp; value'));
  assert.equal(body(html), body(template));
  assert.equal(count(renderRouteDocument(html, route), /<title>/g), 1);
  assert.throws(() => renderRouteDocument(template, {...route, path: '/../escape'}), /Invalid static route/);
  assert.throws(() => renderRouteDocument('<body>No head</body>', route), /no head/);
});

test('the build writes every route document with bundled asset links and a public-only canonical sitemap', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'parkshare-metadata-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const bundled = template.replace('/src/main.jsx', '/assets/synthetic.js');
  await writeFile(join(directory, 'index.html'), bundled);
  await writeFile(join(directory, '404.html'), 'standalone 404 fixture');
  await writeRoutePages(directory);
  for (const route of PARKSHARE_ROUTES) {
    const html = await readFile(join(directory, routeDocumentPath(route).slice(1)), 'utf8');
    assert.ok(html.includes('<title>' + route.title + '</title>')); assert.ok(html.includes('/assets/synthetic.js'));
  }
  assert.equal(await readFile(join(directory, '404.html'), 'utf8'), 'standalone 404 fixture');
  const sitemap = await readFile(join(directory, 'sitemap.xml'), 'utf8');
  assert.equal(sitemap, renderSitemap()); assert.equal(sitemap, await readFile(new URL('public/sitemap.xml', root), 'utf8'));
  assert.ok(!sitemap.includes('?legal=')); assert.ok(!sitemap.includes('/host-dashboard'));
  for (const route of PARKSHARE_ROUTES.filter(r => !r.private)) assert.ok(sitemap.includes('<loc>' + SITE_ORIGIN + route.path + '</loc>'));
  assert.equal(count(sitemap, /<lastmod>/g), PARKSHARE_ROUTES.filter(r => !r.private).length);
  assert.match(SITE_METADATA_UPDATED, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(routePagesPlugin().apply, 'build');
});

test('deployment paths resolve the matching route document and legal query aliases are kept', async () => {
  const config = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
  for (const route of PARKSHARE_ROUTES) for (const path of route.path === '/' ? ['/'] : [route.path, route.path + '/']) assert.ok(config.rewrites.some(r => r.source === path && r.destination === routeDocumentPath(route)));
  for (const section of ['terms', 'privacy', 'payments', 'liability']) {
    const route = getRouteForState('legal', 'Browse', section); assert.equal(route.path, '/' + section);
    assert.ok(config.redirects.some(r => r.source === '/' && r.destination === route.path && r.has?.some(h => h.type === 'query' && h.key === 'legal' && h.value === section)));
  }
  assert.ok(app.includes('section={legalSection}')); assert.ok(app.includes('href="/liability"'));
});

test('each legal route renders only its selected document with one h1, section h2s and links to the other policies', async () => {
  const start = app.indexOf('function LegalDoc('), end = app.indexOf('function ContactField(', start);
  const built = await transform(app.slice(start, end), {loader: 'jsx'});
  const LegalPage = new Function('React', 'C', 'Header', 'HomeFooter', 'SUPPORT_EMAIL', 'getRouteForState', built.code + ';return LegalPage;')(React, {}, () => null, () => null, 'support@example.invalid', getRouteForState);
  for (const section of ['terms', 'privacy', 'payments', 'liability']) {
    const html = renderToStaticMarkup(React.createElement(LegalPage, {section}));
    assert.equal(count(html, /<h1\b/g), 1, section); assert.ok(count(html, /<h2\b/g) > 0);
    assert.ok(html.includes('id="' + section + '"'));
    for (const other of ['terms', 'privacy', 'payments', 'liability'].filter(s => s !== section)) { assert.ok(!html.includes('id="' + other + '"')); assert.ok(html.includes('href="/' + other + '"')); }
  }
});
