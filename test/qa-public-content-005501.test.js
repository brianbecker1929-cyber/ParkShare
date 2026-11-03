import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import React from 'react';
import {transform} from 'esbuild';
import {PARKSHARE_ROUTES} from '../src/lib/routes.js';
import {createPublicRenderer, readOnlyMarkup, structuredData, escapeHtml} from '../scripts/public-content.mjs';
import {writeRoutePages} from '../scripts/route-pages.mjs';

const root = new URL('../', import.meta.url), renderer = await createPublicRenderer();
test.after(() => renderer.close());
const route = path => PARKSHARE_ROUTES.find(r => r.path === path);
const visibleText = html => html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('BUG-005501 the actual homepage and public pages are readable without executing app JavaScript', () => {
  const homepage = renderer.render(route('/'));
  assert.match(homepage.html, /Your spot\. Their destination\./);
  assert.match(homepage.html, /turn your unused driveway into extra income/);
  assert.ok(visibleText(homepage.html).split(' ').length > 400);
  assert.match(homepage.html, /href="\/parking"[^>]*data-public-action/);
  assert.match(homepage.html, /href="\/hosts"[^>]*data-public-action/);
  for (const r of PARKSHARE_ROUTES.filter(r => !r.private)) {
    const result = renderer.render(r);
    assert.equal([...result.html.matchAll(/<h1\b/g)].length, 1, r.path);
    assert.equal([...result.html.matchAll(/<main\b/g)].length, 1, r.path);
    assert.ok(visibleText(result.html).split(' ').length > 100, r.path);
    assert.ok(result.html.includes('Enable JavaScript'), r.path);
  }
});

test('public rendering cannot access providers or embed account pages, booking data or invented availability', () => {
  for (const r of PARKSHARE_ROUTES.filter(r => r.private)) {
    assert.deepEqual(renderer.render(r), {html: '', jsonLd: ''}); assert.equal(structuredData(r), null);
  }
  const parking = renderer.render(route('/parking'));
  assert.match(parking.html, /check live availability/);
  assert.doesNotMatch(parking.html, /pk_live_|sk_live_|bgb_[a-f0-9]|Bearer |booking reference|license_plate|service_role/);
  assert.ok(!parking.html.includes('href="/host-dashboard"'));
});

test('JSON-LD describes the visible organization, website and service without fictional ratings or offers', () => {
  const result = renderer.render(route('/'));
  const data = JSON.parse(result.jsonLd.match(/>([\s\S]*)<\/script>/)[1]);
  assert.equal(data['@context'], 'https://schema.org');
  assert.deepEqual(data['@graph'].map(v => v['@type']), ['Organization', 'WebSite', 'Service']);
  assert.equal(data['@graph'][0].legalName, 'ESKA Technologies Inc.');
  assert.ok(result.html.includes(data['@graph'][0].legalName));
  assert.ok(result.html.includes(data['@graph'][2].areaServed.name));
  assert.doesNotMatch(result.jsonLd, /aggregateRating|reviewCount|priceCurrency|LocalBusiness|streetAddress/);
});

test('FAQ structured answers match the same authored Help data and native no-JS disclosures', () => {
  const result = renderer.render(route('/help'));
  const data = JSON.parse(result.jsonLd.match(/>([\s\S]*)<\/script>/)[1]);
  const faq = data['@graph'].find(v => v['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity.length, renderer.questions.length); assert.ok(faq.mainEntity.length > 20);
  for (const [i, item] of faq.mainEntity.entries()) {
    assert.equal(item.name, renderer.questions[i].q); assert.equal(item.acceptedAnswer.text, renderer.questions[i].a);
    assert.ok(result.html.includes('<summary>' + escapeHtml(item.name) + '</summary>'));
    assert.ok(result.html.includes('<p>' + escapeHtml(item.acceptedAnswer.text) + '</p>'));
  }
});

test('read-only document links work while interactive controls/forms stay disabled until the app commits', () => {
  const html = readOnlyMarkup('<form><input name="name"/><textarea></textarea><select></select><button type="submit">Send</button></form><button>Find Parking →</button>');
  assert.doesNotMatch(html, /<form|<\/form>|\/ disabled|<input[^>]*\/ disabled/);
  assert.match(html, /<input name="name" disabled="">/); assert.match(html, /<textarea disabled="">/);
  assert.match(html, /<button[^>]* disabled=""[^>]*>Send/);
  assert.match(html, /<a[^>]*href="\/parking"[^>]*>Find Parking/);
});

test('successful React commit removes the separate public document; render/boot failure retains it', async () => {
  const source = await readFile(new URL('src/main.jsx', root), 'utf8'), start = source.indexOf('function PublicDocumentHandoff(');
  assert.ok(start > 0);
  const built = await transform(source.slice(start, source.indexOf('\n}\n', start) + 3), {loader: 'jsx'});
  const effects = []; let removed = 0;
  const doc = {getElementById(id) { assert.equal(id, 'public-document'); return removed ? null : {remove() { removed++; }}; }};
  const Handoff = new Function('React', 'document', built.code + ';return PublicDocumentHandoff;')({...React, useLayoutEffect: fn => effects.push(fn)}, doc);
  assert.equal(Handoff({children: 'interactive app'}), 'interactive app'); assert.equal(removed, 0, 'render alone does not discard the document');
  effects[0](); effects[0](); assert.equal(removed, 1, 'successful/StrictMode commit is safe to replay');
  assert.match(source, /<ErrorBoundary>\s*<PublicDocumentHandoff><App \/><\/PublicDocumentHandoff>/);
});

test('rebuilding replaces public markup/JSON-LD and preserves the hydrated home, private empty root and 404 page', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'parkshare-public-doc-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await writeFile(join(directory, 'index.html'), await readFile(new URL('index.html', root), 'utf8'));
  await writeFile(join(directory, '404.html'), 'existing 404');
  await writeRoutePages(directory); await writeRoutePages(directory);
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  assert.equal([...html.matchAll(/id="public-document"/g)].length, 1);
  assert.equal([...html.matchAll(/id="parkshare-structured-data"/g)].length, 1);
  assert.match(html, /<div id="root" data-home-hydration="v1">/);
  assert.match(html, /<noscript><style>#root\[data-home-hydration\]/);
  assert.equal(await readFile(join(directory, '404.html'), 'utf8'), 'existing 404');
  const privateHtml = await readFile(join(directory, 'profile/index.html'), 'utf8');
  assert.match(privateHtml, /<div id="root"><\/div>/);
  assert.ok(!privateHtml.includes('id="public-document"')); assert.ok(!privateHtml.includes('application/ld+json'));
});

test('llms.txt is a concise public Markdown overview with one H1 and canonical links, referenced from robots', async () => {
  const text = await readFile(new URL('public/llms.txt', root), 'utf8');
  assert.equal([...text.matchAll(/^# /gm)].length, 1); assert.match(text, /^# ParkShare\n\n>/);
  for (const path of ['/parking', '/hosts', '/drivers', '/help', '/terms', '/privacy']) assert.ok(text.includes('https://www.myparkshare.ca' + path));
  assert.match(text, /final price.*checkout/); assert.doesNotMatch(text, /<html|sk_live_|Bearer |guaranteed income/);
  assert.match(await readFile(new URL('public/robots.txt', root), 'utf8'), /https:\/\/www\.myparkshare\.ca\/llms\.txt/);
});
