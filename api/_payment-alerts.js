// Opt-in operational notifications. Never pass an event body, error object,
// customer data or credentials into an alert. Only the private alert outbox
// is written; no booking, refund, transfer or Stripe mutation is performed.
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
  if (!mailbox(env.PAYMENT_ALERT_EMAIL_TO) || !mailbox(sender) || !sender.endsWith('@myparkshare.ca')
    || !env.RESEND_API_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
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
  return {payload, idempotencyKey: paymentAlertIdempotencyKey(kind, payload, config.environment)};
}

export function paymentAlertIdempotencyKey(kind, payload, environment) {
  // A fixed field order survives JSONB key reordering after persistence.
  const digest = createHash('sha256').update(JSON.stringify([payload.from, payload.to, payload.subject, payload.text])).digest('hex');
  return `parkshare-payment-alert-v2/${environment}/${kind}/${digest}`;
}

export function paymentAlertJobMatchesConfiguration(job, config) {
  const p = job?.payload;
  return Boolean(Object.hasOwn(KINDS, job?.kind) && job.livemode === config.live && p
    && Object.keys(p).length === 4 && ['from','to','subject','text'].every(k => Object.hasOwn(p,k))
    && p.from === config.from && Array.isArray(p.to) && p.to.length === 1 && p.to[0] === config.to
    && p.subject === `[ParkShare ${config.live ? 'LIVE' : 'TEST'}] ${KINDS[job.kind][0]}`
    && typeof p.text === 'string' && p.text.length <= 5000
    && job.idempotency_key === paymentAlertIdempotencyKey(job.kind, p, config.environment));
}

const defaultDatabase = async () => (await import('./_lib.js')).supabaseAdmin;
export function createPaymentAlertReporter({env = process.env, db, dbFactory = defaultDatabase, logger = console} = {}) {
  return async function report(kind, input) {
    // Persist before responding; a separate, opt-in worker owns email sends.
    // Queue failures must not alter the existing financial result.
    try {
      const config = paymentAlertConfiguration(env);
      if (!config.enabled) {
        if (config.reason !== 'disabled') logger.error?.('[payment-alert] not configured', {reason: config.reason});
        return {status: config.reason};
      }
      const alert = buildPaymentAlert(kind, input, config);
      if (!alert) return {status: 'invalid_alert'};
      const database = db || await dbFactory();
      const result = await database.rpc('enqueue_payment_alert', {p_key: alert.idempotencyKey, p_kind: kind,
        p_livemode: config.live, p_payload: alert.payload}).abortSignal(AbortSignal.timeout(2500));
      if (result.error) throw new Error('queue_unavailable');
      const job = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!job?.id) throw new Error('invalid_queue_response');
      return {status: job.accepted_at ? 'already_accepted' : job.blocked_at ? 'blocked' : 'queued'};
    } catch {
      // A database outage can also prevent queuing; retain the original
      // incident log/Stripe retry and require independent outage monitoring.
      try { logger.error?.('[payment-alert] queue unavailable', {kind: Object.hasOwn(KINDS, kind) ? kind : 'invalid'}); } catch {}
      return {status: 'queue_unavailable'};
    }
  };
}

export const reportPaymentAlert = createPaymentAlertReporter();
