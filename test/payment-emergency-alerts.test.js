import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPaymentAlert, createPaymentAlertReporter, paymentAlertConfiguration} from '../api/_payment-alerts.js';

const qa = () => ({PAYMENT_ALERTS_ENABLED: 'true', PAYMENT_ALERTS_ENVIRONMENT: 'qa',
  PAYMENT_ALERT_EMAIL_TO: 'operator@example.invalid', EMAIL_FROM: 'ParkShare <alerts@myparkshare.ca>',
  RESEND_API_KEY: 're_synthetic_only', STRIPE_SECRET_KEY: 'sk_test_synthetic_only', VERCEL_ENV: 'preview',
  VERCEL_PROJECT_ID: 'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC', SUPABASE_URL: 'https://heqxirlsorcztsawaldg.supabase.co'});
const incident = () => ({eventId: 'evt_synthetic', sessionId: 'cs_test_synthetic', connectedAccountId: 'acct_synthetic', livemode: false});
const providerId = '00000000-0000-4000-8000-000000000001';
const accepted = () => ({ok: true, json: async () => ({id: providerId})});
function transport(env = qa(), response = accepted) {
  const requests = [], logs = [];
  const reporter = createPaymentAlertReporter({env, fetchImpl: async (url, init) => {requests.push({url, ...init}); return response();},
    logger: {info: (...args) => logs.push(args), error: (...args) => logs.push(args)}});
  return {reporter, requests, logs};
}

test('default configuration cannot call an email provider, including with inherited credentials', async () => {
  for (const enabled of [undefined, '', 'false', 'TRUE', '1']) {
    const env = {...qa(), PAYMENT_ALERTS_ENABLED: enabled}, f = transport(env);
    assert.deepEqual(await f.reporter('paid_checkout_needs_review', incident()), {status: 'disabled'});
    assert.equal(f.requests.length, 0);
  }
});

test('mode, project, database and production-target bindings reject cross-environment alerts', async () => {
  for (const patch of [
    {STRIPE_SECRET_KEY: 'sk_live_synthetic'}, {STRIPE_SECRET_KEY: ''}, {PAYMENT_ALERTS_ENVIRONMENT: 'unknown'},
    {VERCEL_PROJECT_ID: 'prj_oGpk1UWJ0NfPfAIxBYQv6bkv437z'}, {SUPABASE_URL: 'https://oyxrussraxjgqwzpwyca.supabase.co'},
  ]) {
    const f = transport({...qa(), ...patch});
    assert.deepEqual(await f.reporter('webhook_processing_failed', incident()), {status: 'environment_mismatch'});
    assert.equal(f.requests.length, 0);
  }
  const env = {...qa(), PAYMENT_ALERTS_ENVIRONMENT: 'production', STRIPE_SECRET_KEY: 'rk_live_synthetic',
    VERCEL_PROJECT_ID: 'prj_oGpk1UWJ0NfPfAIxBYQv6bkv437z', SUPABASE_URL: 'https://oyxrussraxjgqwzpwyca.supabase.co'};
  assert.equal(paymentAlertConfiguration(env).enabled, false, 'Live alerts cannot run in Preview');
  env.VERCEL_ENV = 'production';
  const f = transport(env);
  assert.equal((await f.reporter('webhook_processing_failed', {...incident(), livemode: true})).status, 'accepted');
  assert.match(JSON.parse(f.requests[0].body).subject, /\bLIVE\b/);
  assert.equal((await f.reporter('webhook_processing_failed', incident())).status, 'invalid_alert');
  assert.equal(f.requests.length, 1);
});

test('single monitored recipient and verified-domain sender are required', async () => {
  for (const patch of [{PAYMENT_ALERT_EMAIL_TO: ''}, {PAYMENT_ALERT_EMAIL_TO: 'one@example.invalid,two@example.invalid'},
    {PAYMENT_ALERT_EMAIL_TO: 'one@example.invalid\r\nBcc: two@example.invalid'}, {EMAIL_FROM: 'alerts@example.invalid'},
    {RESEND_API_KEY: ''}, {EMAIL_FROM: 'alerts@myparkshare.ca>'}, {EMAIL_FROM: '<alerts@myparkshare.ca'},
    {EMAIL_FROM: 'ParkShare <alerts@myparkshare.ca>\nBcc: hidden@example.invalid'}]) {
    const f = transport({...qa(), ...patch});
    assert.equal((await f.reporter('webhook_processing_failed', incident())).status, 'configuration_missing');
    assert.equal(f.requests.length, 0);
  }
});

test('identical incident retries reuse exactly the same email and provider idempotency key', async () => {
  const f = transport();
  await f.reporter('paid_checkout_needs_review', incident());
  await f.reporter('paid_checkout_needs_review', {...incident(), attempt: 3, error: new Error('different transient error')});
  assert.equal(f.requests[0].body, f.requests[1].body);
  assert.equal(f.requests[0].headers['Idempotency-Key'], f.requests[1].headers['Idempotency-Key']);
  await f.reporter('paid_checkout_needs_review', {...incident(), eventId: 'evt_another'});
  assert.notEqual(f.requests[0].headers['Idempotency-Key'], f.requests[2].headers['Idempotency-Key']);
  const body = JSON.parse(f.requests[0].body);
  assert.deepEqual(body.to, ['operator@example.invalid']);
  assert.match(body.subject, /\bTEST\b/);
  assert.equal(f.requests[0].url, 'https://api.resend.com/emails');
  assert.ok(f.requests[0].signal instanceof AbortSignal);
});

test('email redaction drops raw errors, metadata, customer details, arbitrary URLs and malformed identifiers', () => {
  const config = paymentAlertConfiguration(qa());
  const alert = buildPaymentAlert('refund_needs_review', {...incident(), bookingId: 130,
    operationId: providerId, refundId: 're_safe', metadata: {customer: 'DO_NOT_SEND'},
    email: 'DO_NOT_SEND', address: 'DO_NOT_SEND', error: 'sk_live_DO_NOT_SEND',
    eventId: 'evt_unsafe\nDO_NOT_SEND', sessionId: 'https://DO_NOT_SEND',
    reason: 'DO_NOT_SEND', token: 'DO_NOT_SEND'}, config);
  assert.doesNotMatch(JSON.stringify(alert), /DO_NOT_SEND|sk_live_|metadata|address/);
  assert.match(alert.payload.text, /bookingId: 130/);
  assert.match(alert.payload.text, /operationId: 00000000/);
  assert.equal(buildPaymentAlert('arbitrary DO_NOT_SEND', incident(), config), null);
  assert.equal(buildPaymentAlert('refund_needs_review', {livemode: false, bookingId: 130}, config), null);
  assert.equal(buildPaymentAlert('refund_needs_review', {...incident(), livemode: null}, config), null);
});

test('provider failures and unreadable responses do not escape or leak credentials into logs', async () => {
  for (const response of [() => {throw new Error('DO_NOT_SEND re_secret');}, () => ({ok: false, text: () => assert.fail('raw response must not be read')}),
    () => ({ok: true, json: async () => {throw new Error('DO_NOT_SEND');}}), () => ({ok: true, json: async () => ({id: 'DO_NOT_SEND'})})]) {
    const f = transport(qa(), response);
    assert.equal((await f.reporter('refund_failed', incident())).status, 'delivery_failed');
    assert.doesNotMatch(JSON.stringify(f.logs), /DO_NOT_SEND|re_secret|re_synthetic_only|sk_test_/);
  }
  const brokenLog = createPaymentAlertReporter({env: qa(), fetchImpl: async () => {throw new Error('private');},
    logger: {error() {throw new Error('logger failed');}}});
  assert.equal((await brokenLog('refund_failed', incident())).status, 'delivery_failed');
});

const source = readFileSync(new URL('../api/stripe-webhook.js', import.meta.url), 'utf8');
function webhook({type = 'checkout.session.completed', fail = true, unsigned = false, providerFails = false} = {}) {
  const f = transport(qa(), providerFails ? () => {throw new Error('provider unavailable');} : accepted);
  const event = {id: 'evt_synthetic', type, livemode: false, account: 'acct_synthetic',
    data: {object: {id: type.startsWith('refund.') ? 're_synthetic' : 'cs_test_synthetic', payment_status: 'paid',
      status: 'failed', metadata: {email: 'DO_NOT_SEND'}}}};
  const deps = {reportPaymentAlert: f.reporter, readRawBody: async () => 'signed fixture',
    stripe: {webhooks: {constructEvent() {if (unsigned) throw new Error('invalid signature'); return event;}}},
    processPaidCheckout: async () => {if (fail) throw new Error('database unavailable DO_NOT_SEND');},
    recoverRejectedExtensionRefund: async () => {}, reconcilePaymentRefund: async () => {},
    supabaseAdmin: {}, paidCheckoutReferenceLog: () => null,
    console: {info() {}, error() {}}};
  const code = source.slice(source.indexOf('export default async function handler'))
    .replace('export default async function handler', 'return async function handler');
  const handler = new Function(...Object.keys(deps), code)(...Object.values(deps));
  return {...f, async run() {
    const res = {status(n) {this.code = n; return this;}, json(value) {this.body = value; return this;}, send() {return this;}};
    await handler({method: 'POST', headers: {'stripe-signature': 'synthetic'}}, res);
    return res;
  }};
}

test('a paid checkout failure alerts while preserving webhook 500 and automatic Stripe retry', async () => {
  for (const providerFails of [false, true]) {
    const f = webhook({providerFails}), res = await f.run();
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, {error: 'Webhook processing failed'});
    assert.equal(f.requests.length, 1);
    assert.match(JSON.parse(f.requests[0].body).subject, /Paid checkout needs reconciliation/);
    assert.doesNotMatch(f.requests[0].body, /DO_NOT_SEND/);
  }
});

test('successful checkouts and unsigned requests never emit emergency email', async () => {
  const success = webhook({fail: false});
  assert.equal((await success.run()).code, 200); assert.equal(success.requests.length, 0);
  const unsigned = webhook({unsigned: true});
  assert.equal((await unsigned.run()).code, 400); assert.equal(unsigned.requests.length, 0);
});

test('signed refund failures alert after normal reconciliation without creating another refund', async () => {
  for (const type of ['refund.failed', 'refund.updated']) {
    const f = webhook({type}), res = await f.run();
    assert.equal(res.code, 200); assert.equal(f.requests.length, 1);
    assert.match(JSON.parse(f.requests[0].body).text, /refundId: re_synthetic/);
  }
});
