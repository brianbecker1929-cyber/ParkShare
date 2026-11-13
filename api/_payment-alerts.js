// Opt-in operational notifications. Never pass an event body, error object,
// customer data or credentials into an alert. No database or Stripe writes.
import {createHash} from 'node:crypto';

const ENVIRONMENTS = {
  production: {project: 'prj_oGpk1UWJ0NfPfAIxBYQv6bkv437z', database: 'https://oyxrussraxjgqwzpwyca.supabase.co', live: true},
  qa: {project: 'prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC', database: 'https://heqxirlsorcztsawaldg.supabase.co', live: false},
};
const KINDS = {
  webhook_processing_failed: ['Webhook processing failed', 'Inspect the signed event delivery and application logs. Preserve Stripe retries.'],
  paid_checkout_needs_review: ['Paid checkout needs reconciliation', 'Check the original connected-account Charge and the registered checkout before deciding whether a booking or refund is required.'],
  paid_checkout_rejected: ['Paid checkout was not applied', 'Inspect the retained audit record and any refund or dispute. A rejected checkout does not establish that the Driver is still charged.'],
  refund_needs_review: ['Refund or Host reimbursement needs review', 'Reconcile the existing refund and any Host fee transfer before retrying.'],
  refund_retry_required: ['Refund processing needs investigation', 'Inspect the existing operation, provider results and worker logs before retrying.'],
  refund_failed: ['Stripe refund failed', 'Inspect the current original-account refund and retained ledger. Do not submit a second refund automatically.'],
};
const ID_FIELDS = {
  eventId: /^evt_[A-Za-z0-9_]{1,200}$/,
  sessionId: /^cs_[A-Za-z0-9_]{1,200}$/,
  connectedAccountId: /^acct_[A-Za-z0-9_]{1,200}$/,
  operationId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  refundId: /^re_[A-Za-z0-9_]{1,200}$/,
};
const mailbox = value => typeof value === 'string' && value.length <= 254
  && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value);

export function paymentAlertConfiguration(env) {
  if (env.PAYMENT_ALERTS_ENABLED !== 'true') return {enabled: false, reason: 'disabled'};
  const target = ENVIRONMENTS[env.PAYMENT_ALERTS_ENVIRONMENT];
  const live = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || '');
  const test = /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || '');
  // Explicit environment binding prevents inherited Preview settings from
  // emitting Live alerts. These checks concern mode; never log key values.
  if (!target || env.VERCEL_PROJECT_ID !== target.project || env.SUPABASE_URL !== target.database
    || target.live !== live || (!live && !test)
    || target.live && env.VERCEL_ENV !== 'production') return {enabled: false, reason: 'environment_mismatch'};
  const from = env.EMAIL_FROM || '';
  const sender = from.match(/^[^<>\r\n]*<([^<>\r\n]+)>$/)?.[1] || from;
  if (!mailbox(env.PAYMENT_ALERT_EMAIL_TO) || !mailbox(sender) || !sender.endsWith('@myparkshare.ca') || !env.RESEND_API_KEY) {
    return {enabled: false, reason: 'configuration_missing'};
  }
  return {enabled: true, environment: env.PAYMENT_ALERTS_ENVIRONMENT, live: target.live,
    to: env.PAYMENT_ALERT_EMAIL_TO, from, apiKey: env.RESEND_API_KEY};
}

// Pure renderer is also the offline test path. Identifiers are allowlisted;
// caller-supplied titles, explanations, URLs and error details are discarded.
export function buildPaymentAlert(kind, input, config) {
  if (!Object.hasOwn(KINDS, kind) || input?.livemode !== config.live) return null;
  const ids = {};
  for (const [field, pattern] of Object.entries(ID_FIELDS)) {
    if (typeof input[field] === 'string' && pattern.test(input[field])) ids[field] = input[field];
  }
  if (Number.isSafeInteger(input.bookingId) && input.bookingId > 0) ids.bookingId = input.bookingId;
  if (!ids.eventId && !ids.operationId && !ids.sessionId && !ids.refundId) return null;
  const [title, action] = KINDS[kind];
  const mode = config.live ? 'LIVE' : 'TEST';
  const payload = {
    from: config.from, to: [config.to], subject: `[ParkShare ${mode}] ${title}`,
    text: [`ParkShare ${mode} payment alert`, title, '',
      ...Object.entries(ids).map(([name, value]) => `${name}: ${value}`), '', action,
      'This notification does not perform a refund, transfer, booking correction or replay.',
      'Sign in to the existing Stripe and ParkShare dashboards to investigate.'].join('\n'),
  };
  // Exact body and destination form the key: a repeated logical notification
  // cannot conflict with a changed email body. Resend retains keys for 24h;
  // this is bounded provider deduplication, not a durable incident outbox.
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return {payload, idempotencyKey: `parkshare-payment-alert-v1/${config.environment}/${kind}/${digest}`};
}

export function createPaymentAlertReporter({env = process.env, fetchImpl = globalThis.fetch, logger = console} = {}) {
  return async function report(kind, input) {
    // Best-effort bounded delivery: alert failures must not alter financial
    // results, suppress a webhook 500, or release a refund review hold.
    try {
      const config = paymentAlertConfiguration(env);
      if (!config.enabled) {
        if (config.reason !== 'disabled') logger.error?.('[payment-alert] not configured', {reason: config.reason});
        return {status: config.reason};
      }
      const alert = buildPaymentAlert(kind, input, config);
      if (!alert) return {status: 'invalid_alert'};
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', headers: {Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json',
          'Idempotency-Key': alert.idempotencyKey},
        signal: AbortSignal.timeout(2500), body: JSON.stringify(alert.payload),
      });
      if (!response.ok) throw new Error('provider_rejected');
      const result = await response.json();
      if (typeof result?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(result.id)) throw new Error('invalid_provider_response');
      logger.info?.('[payment-alert] accepted', {kind, livemode: config.live});
      return {status: 'accepted'};
    } catch {
      // Never log the provider response, request headers or raw exception.
      try { logger.error?.('[payment-alert] delivery failed', {kind: Object.hasOwn(KINDS, kind) ? kind : 'invalid'}); } catch {}
      return {status: 'delivery_failed'};
    }
  };
}

export const reportPaymentAlert = createPaymentAlertReporter();
