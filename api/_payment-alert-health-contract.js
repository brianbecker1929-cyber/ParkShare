// Dependency-free protocol shared with the independent checker.
export const ALERT_HEALTH_VERSION = 1;
export const WORKER_MAX_AGE_MS = 5 * 60_000;
export const HEALTH_ISSUES = ['worker_missing','worker_stale','worker_failed','queue_stalled','queue_blocked',
  'database_unavailable','configuration_inactive','health_invalid','probe_failed','monitor_configuration_invalid'];
const integer = n => Number.isSafeInteger(n) && n >= 0;

export function classifyPaymentAlertHealth(snapshot, now = Date.now()) {
  const observed = Date.parse(snapshot?.observed_at);
  const worker = snapshot?.worker_completed_at === null ? null : Date.parse(snapshot?.worker_completed_at);
  if (!Number.isFinite(now) || !Number.isFinite(observed) || Math.abs(now-observed) > 60_000
    || worker !== null && (!Number.isFinite(worker) || worker > observed + 1000)
    || !['worker_failed_count','pending_count','blocked_count','stale_pending_count'].every(k=>integer(snapshot?.[k]))
    || snapshot.worker_failed_count > 5 || snapshot.stale_pending_count > snapshot.pending_count) return ['health_invalid'];
  const issues = [];
  if (worker === null) issues.push('worker_missing');
  else if (observed-worker > WORKER_MAX_AGE_MS) issues.push('worker_stale');
  if (snapshot.worker_failed_count) issues.push('worker_failed');
  if (snapshot.stale_pending_count) issues.push('queue_stalled');
  if (snapshot.blocked_count) issues.push('queue_blocked');
  return issues;
}

export function validatePaymentAlertHealthResponse(data,{environment,probe,now}) {
  const stamp=Date.parse(data?.observedAt);
  if(data?.version!==ALERT_HEALTH_VERSION || data.probe!==probe || data.environment!==environment
    || data.livemode!==(environment==='production') || !Number.isFinite(stamp) || Math.abs(now-stamp)>60_000
    || typeof data.healthy!=='boolean' || !Array.isArray(data.issues) || data.issues.length>HEALTH_ISSUES.length
    || !data.issues.every(i=>HEALTH_ISSUES.includes(i)) || new Set(data.issues).size!==data.issues.length
    || data.healthy!==(data.issues.length===0))return null;
  const infrastructure=['database_unavailable','configuration_inactive','health_invalid'];
  if(!data.healthy && data.issues.length===1 && infrastructure.includes(data.issues[0]))return data.issues;
  const actual=classifyPaymentAlertHealth({observed_at:data.observedAt,worker_completed_at:data.workerCompletedAt,
    pending_count:data.pendingCount,blocked_count:data.blockedCount,stale_pending_count:data.stalePendingCount,
    worker_failed_count:data.workerFailedCount},now);
  return actual.length===data.issues.length && actual.every((value,index)=>value===data.issues[index]) ? actual : null;
}
