import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import sharp from 'sharp';
import {HOME_HERO_IMAGE, HOME_HERO_AVIF_SRC_SET} from '../src/lib/homeHeroImage.js';
import {renderRouteDocument, writeRoutePages} from '../scripts/route-pages.mjs';
import {PARKSHARE_ROUTES} from '../src/lib/routes.js';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('BUG-005495 the shipped public homepage and client use the same responsive image and preload', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'parkshare-hero-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const template = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  await writeFile(join(directory, 'index.html'), template);
  await writeRoutePages(directory);
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  const {document} = new JSDOM(html).window;
  const img = document.querySelector('img.ps-mascot-home-hero');
  assert.ok(img, 'the hero must be discoverable before JavaScript executes');
  assert.equal(img.getAttribute('srcset'), HOME_HERO_IMAGE.srcSet);
  assert.equal(img.getAttribute('sizes'), '(max-width: 820px) 220px, 380px');
  assert.equal(img.loading || img.getAttribute('loading'), 'eager');
  assert.equal(img.getAttribute('fetchpriority'), 'high');
  assert.equal(img.parentElement.tagName, 'PICTURE');
  const source = img.parentElement.querySelector('source');
  const preload = document.querySelector('link[data-home-hero-preload]');
  assert.equal(source.getAttribute('type'), 'image/avif');
  assert.equal(source.getAttribute('srcset'), HOME_HERO_AVIF_SRC_SET);
  assert.equal(preload.getAttribute('imagesrcset'), source.getAttribute('srcset'));
  assert.equal(preload.getAttribute('imagesizes'), img.getAttribute('sizes'));
  assert.equal(preload.getAttribute('type'), 'image/avif');
  assert.equal(document.querySelectorAll('link[as="image"]').length, 1);
  for (const logo of document.querySelectorAll('.ps-footer-v2-logo img, .ps-footer-v2-powered-logo img')) {
    assert.equal(logo.getAttribute('loading'), 'lazy');
    assert.ok(Number(logo.getAttribute('width')) > 0);
    assert.ok(Number(logo.getAttribute('height')) > 0);
    assert.ok((await stat(new URL('../public' + logo.getAttribute('src'), import.meta.url))).size < 50_000);
  }
  for (const route of PARKSHARE_ROUTES) {
    const routed = renderRouteDocument(html, route);
    assert.equal(new JSDOM(routed).window.document.querySelectorAll('[data-home-hero-preload]').length, route.path === '/' ? 1 : 0,
      'private and other public routes must not fetch the homepage hero');
  }
});

test('BUG-005495 optimized hero variants retain dimensions and transparency within transfer budgets', async () => {
  const original = await stat(new URL('../public/william-parker-v2/web/1122px/ParkShare_William_Parker_01_Joint_Greeting_Wave-1122.webp', import.meta.url));
  for (const width of [320, 480, 768, 1122]) for (const format of ['webp', 'avif']) {
    const file = new URL(`../public/home-hero/welcome-${width}.${format}`, import.meta.url);
    const metadata = await sharp(await readFile(file)).metadata();
    assert.equal(metadata.width, width);
    assert.equal(metadata.height, Math.round(width * 1402 / 1122));
    assert.equal(metadata.hasAlpha, true);
    assert.ok((await stat(file)).size < original.size * 0.65);
    if (width === 768 && format === 'avif') assert.ok((await stat(file)).size < 55_000);
  }
});
