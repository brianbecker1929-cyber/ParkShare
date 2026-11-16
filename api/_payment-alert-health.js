import {paymentAlertConfiguration} from './_payment-alerts.js';
import {ALERT_HEALTH_VERSION,classifyPaymentAlertHealth} from './_payment-alert-health-contract.js';
export {classifyPaymentAlertHealth} from './_payment-alert-health-contract.js';

const integer = n => Number.isSafeInteger(n) && n >= 0;
const query = rpc => rpc.abortSignal(AbortSignal.timeout(2500));

export async function recordPaymentAlertWorkerHealth({db, counts, env = process.env}) {
  const config = paymentAlertConfiguration(env);
  if (!config.enabled || !integer(counts?.failed) || counts.failed > 5) throw new Error('invalid_worker_health');
  const result = await query(db.rpc('record_payment_alert_worker_health', {p_livemode:config.live,p_failed_count:counts.failed}));
  if (result.error || result.data !== true) throw new Error('worker_health_unavailable');
}

export async function getPaymentAlertHealth({db, env = process.env, probe, now = Date.now()}) {
  const config = paymentAlertConfiguration(env);
  const base = {version:ALERT_HEALTH_VERSION,probe,environment:env.PAYMENT_ALERTS_ENVIRONMENT,
    livemode:config.enabled ? config.live : null,observedAt:new Date(now).toISOString()};
  if (!config.enabled) return {...base,healthy:false,issues:['configuration_inactive']};
  try {
    const {data,error} = await query(db.rpc('get_payment_alert_health',{p_livemode:config.live}));
    if (error) throw new Error('health_query_failed');
    const issues = classifyPaymentAlertHealth(data, now);
    if (issues.includes('health_invalid')) return {...base,healthy:false,issues};
    return {...base,observedAt:data.observed_at,healthy:issues.length===0,issues,
      workerCompletedAt:data.worker_completed_at,pendingCount:data.pending_count,
      blockedCount:data.blocked_count,stalePendingCount:data.stale_pending_count,workerFailedCount:data.worker_failed_count};
  } catch {return {...base,healthy:false,issues:['database_unavailable']};}
}
