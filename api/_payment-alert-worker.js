import {randomUUID} from 'node:crypto';
import {paymentAlertConfiguration, paymentAlertJobMatchesConfiguration} from './_payment-alerts.js';

const RETRY_WINDOW_MS = 23 * 3600_000;
const MAX_ATTEMPTS = 8;
const queryTimeout = query => query.abortSignal(AbortSignal.timeout(2500));

export async function processPaymentAlert({db, id, config, fetchImpl = globalThis.fetch, now = new Date()}) {
  const token = randomUUID();
  const claim = await queryTimeout(db.rpc('claim_payment_alert', {p_id: id, p_token: token, p_livemode: config.live}));
  if (claim.error) throw new Error('payment_alert_claim_failed');
  const job = Array.isArray(claim.data) ? claim.data[0] : claim.data;
  if (!job?.id) return 'busy';
  if (job.blocked_at) return 'blocked';
  const finish = async (outcome, code, providerId = null, delay = 30) => {
    const result = await queryTimeout(db.rpc('finish_payment_alert', {p_id: id, p_token: token,
      p_outcome: outcome, p_provider_id: providerId, p_code: code, p_delay_seconds: delay}));
    if (result.error || result.data !== true) throw new Error('payment_alert_ack_failed');
    return outcome === 'retry' ? 'pending' : outcome;
  };
  if (!paymentAlertJobMatchesConfiguration(job, config)) return finish('blocked', 'configuration_changed');
  const firstAttempt = Date.parse(job.first_attempt_at);
  if (!Number.isFinite(firstAttempt) || now.getTime() - firstAttempt >= RETRY_WINDOW_MS) {
    return finish('blocked', 'idempotency_window_expired');
  }
  if (!Number.isSafeInteger(Number(job.attempts)) || Number(job.attempts) < 1 || Number(job.attempts) > MAX_ATTEMPTS) {
    return finish('blocked', 'attempts_exhausted');
  }
  let response, result;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', headers: {Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json',
        'Idempotency-Key': job.idempotency_key},
      signal: AbortSignal.timeout(2500), body: JSON.stringify(job.payload),
    });
    if (response.ok || response.status === 409) result = await response.json();
  } catch {
    // The provider may have accepted a request whose response was lost.
    // Persist the retry with the identical body/key; never invent a new send.
  }
  if (response?.ok && typeof result?.id === 'string' && /^[0-9a-f-]{36}$/i.test(result.id)) {
    return finish('accepted', null, result.id);
  }
  const concurrent = response?.status === 409 && result?.name === 'concurrent_idempotent_requests';
  if (response && response.status >= 400 && response.status < 500 && response.status !== 429 && !concurrent) {
    return finish('blocked', 'provider_rejected');
  }
  if (Number(job.attempts) >= MAX_ATTEMPTS) return finish('blocked', 'attempts_exhausted');
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  const delay = Math.min(3600, Math.max(30, 30 * 2 ** Math.min(Number(job.attempts) - 1, 7),
    Number.isFinite(retryAfter) ? retryAfter : 0));
  return finish('retry', 'provider_unavailable', null, Math.ceil(delay));
}

export async function drainPaymentAlerts({db, env = process.env, fetchImpl = globalThis.fetch, now = new Date(), limit = 5}) {
  const config = paymentAlertConfiguration(env);
  if (!config.enabled) return {enabled: false, reason: config.reason};
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5) throw new RangeError('Payment alert batch limit must be 1–5');
  const pending = await queryTimeout(db.from('payment_alert_deliveries').select('id')
    .eq('livemode', config.live).is('accepted_at', null).is('blocked_at', null)
    .lte('lease_until', now.toISOString()).lte('next_attempt_at', now.toISOString())
    .order('created_at').limit(limit));
  if (pending.error) throw new Error('payment_alert_queue_unavailable');
  const counts = {enabled: true, accepted: 0, pending: 0, blocked: 0, busy: 0, failed: 0};
  for (const job of pending.data || []) {
    try { counts[await processPaymentAlert({db, id: job.id, config, fetchImpl, now})]++; }
    catch { counts.failed++; }
  }
  return counts;
}
