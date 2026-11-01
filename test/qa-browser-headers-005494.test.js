import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PARKSHARE_ROUTES} from '../src/lib/routes.js';

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const matchingHeaders = path => {
  const result = new Map();
  for (const rule of config.headers || []) {
    if (new RegExp('^' + rule.source + '$').test(path)) {
      for (const {key, value} of rule.headers) result.set(key.toLowerCase(), value);
    }
  }
  return result;
};
const directives = value => new Map((value || '').split(';').filter(v => v.trim()).map(v => {
  const [name, ...sources] = v.trim().split(/\s+/); return [name, sources];
}));

test('BUG-005494 frame, MIME, referrer and device protections apply to every route, static file and API', () => {
  const paths = [...PARKSHARE_ROUTES.flatMap(r => r.path === '/' ? ['/'] : [r.path, r.path + '/']),
    '/not-a-real-route', '/404.html', '/legal.html', '/assets/app.js', '/website-logo.png', '/icons/site.webmanifest',
    '/api/public-parking', '/api/profile', '/api/stripe-webhook'];
  for (const path of paths) {
    const h = matchingHeaders(path), csp = directives(h.get('content-security-policy'));
    assert.deepEqual(csp.get('frame-ancestors'), ["'none'"], path);
    assert.deepEqual(csp.get('object-src'), ["'none'"], path);
    assert.deepEqual(csp.get('base-uri'), ["'self'"], path);
    assert.equal(h.get('x-frame-options'), 'DENY', path);
    assert.equal(h.get('x-content-type-options'), 'nosniff', path);
    assert.equal(h.get('referrer-policy'), 'strict-origin-when-cross-origin', path);
    assert.equal(h.get('permissions-policy'), 'geolocation=(self), camera=(), microphone=()', path);
    // Preserve Vercel's existing HSTS value rather than accidentally replacing it.
    assert.equal(h.has('strict-transport-security'), false);
  }
});

test('resource restrictions are staged in report-only while clickjacking protection is enforced now', () => {
  const h = matchingHeaders('/'), enforced = directives(h.get('content-security-policy'));
  const candidate = directives(h.get('content-security-policy-report-only'));
  assert.ok(enforced.has('frame-ancestors'));
  assert.equal(enforced.has('script-src'), false, 'integration retest must precede resource-policy enforcement');
  assert.deepEqual(candidate.get('default-src'), ["'self'"]);
  assert.ok(!candidate.has('report-uri') && !candidate.has('report-to'), 'no new endpoint or third-party violation upload');
  const scripts = candidate.get('script-src');
  assert.ok(!scripts.includes('*') && !scripts.includes('https:') && !scripts.includes("'unsafe-inline'"));
  assert.ok(!scripts.some(s => s.includes('supabase')), 'user storage is not trusted to execute scripts');
  for (const origin of ['https://maps.googleapis.com', 'https://maps.gstatic.com', 'https://js.stripe.com', 'https://checkout.stripe.com']) assert.ok(scripts.includes(origin), origin);
});

test('the candidate permits the existing boot diagnostic by its exact hash without permitting arbitrary inline code', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = directives(matchingHeaders('/').get('content-security-policy-report-only')).get('script-src');
  const inline = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) && body.trim());
  assert.ok(inline.length > 0);
  for (const [, , body] of inline) assert.ok(scripts.includes("'sha256-" + createHash('sha256').update(body).digest('base64') + "'"));
  const injected = "'sha256-" + createHash('sha256').update('window.injected = true').digest('base64') + "'";
  assert.ok(!scripts.includes(injected));
});

test('the staged policy covers current provider connections, frames, fonts, images and map workers', () => {
  const p = directives(matchingHeaders('/parking').get('content-security-policy-report-only'));
  for (const origin of ['https://*.supabase.co', 'wss://*.supabase.co', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://nominatim.openstreetmap.org', 'https://api.stripe.com', 'https://checkout.stripe.com']) assert.ok(p.get('connect-src').includes(origin), origin);
  for (const origin of ['https://js.stripe.com', 'https://hooks.stripe.com', 'https://checkout.stripe.com', 'https://www.youtube-nocookie.com']) assert.ok(p.get('frame-src').includes(origin), origin);
  assert.ok(p.get('style-src').includes('https://fonts.googleapis.com'));
  assert.ok(p.get('font-src').includes('https://fonts.gstatic.com'));
  assert.ok(p.get('worker-src').includes('blob:'));
  for (const scheme of ['data:', 'blob:', 'https:']) assert.ok(p.get('img-src').includes(scheme));
  assert.deepEqual(p.get('form-action'), ["'self'", 'https://checkout.stripe.com', 'https://connect.stripe.com']);
});
