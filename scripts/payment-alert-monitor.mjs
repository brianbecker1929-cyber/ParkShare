// Independent, read-only observer. No database, Stripe or CRON_SECRET credentials.
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validatePaymentAlertHealthResponse} from '../api/_payment-alert-health-contract.js';

const TARGETS = {
  production:'https://www.myparkshare.ca/api/payment-alert-health',
  qa:'https://parkshare-qa-git-qa-recovery-preflight-oct27-eska-technologies.vercel.app/api/payment-alert-health',
};
const mailbox = s => typeof s === 'string' && s.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(s);
async function readJson(response) {
  const reader=response.body?.getReader();
  if (!reader) throw new Error('invalid_body');
  let size=0;const chunks=[];
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>8192)throw new Error('large_body');chunks.push(Buffer.from(value));}
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally {await reader.cancel().catch(()=>{});}
}
export function monitorConfiguration(env) {
  const environment=env.PAYMENT_ALERT_MONITOR_ENVIRONMENT;
  if(!Object.hasOwn(TARGETS,environment))return null;
  const url=TARGETS[environment];
  const secret=env.PAYMENT_ALERT_MONITOR_SECRET;
  if (!url || typeof secret !== 'string' || secret.length<32 || /[\r\n]/.test(secret)
    || !['true','false',undefined].includes(env.PAYMENT_ALERT_MONITOR_SEND_EMAIL)) return null;
  const notify=env.PAYMENT_ALERT_MONITOR_SEND_EMAIL==='true';
  const from=env.PAYMENT_ALERT_MONITOR_FROM || '', sender=from.match(/^[^<>\r\n]*<([^<>\r\n]+)>$/)?.[1] || from;
  if(notify && (!mailbox(env.PAYMENT_ALERT_EMAIL_TO) || !mailbox(sender)
    || !sender.endsWith('@myparkshare.ca') || !env.RESEND_API_KEY || /[\r\n]/.test(from)))return null;
  return {environment,url,secret,notify,from,to:env.PAYMENT_ALERT_EMAIL_TO,apiKey:env.RESEND_API_KEY};
}

export async function runPaymentAlertMonitor({env=process.env,fetchImpl=globalThis.fetch,now=Date.now(),probe=randomUUID()}={}) {
  const config=monitorConfiguration(env);
  if(!config || !Number.isFinite(now))return {healthy:false,issues:['monitor_configuration_invalid'],notification:'not_attempted'};
  let issues=['probe_failed'];
  try {
    const response=await fetchImpl(config.url,{method:'GET',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${config.secret}`,'x-parkshare-health-probe':probe}});
    if(response.status===200 || response.status===503){
      const data=await readJson(response);
      const checked=validatePaymentAlertHealthResponse(data,{environment:config.environment,probe,now});
      if(checked && response.status===(checked.length?503:200))issues=checked;
    }
  } catch { /* The original URL, body and exception are never logged or emailed. */ }
  if(issues.length===0)return {healthy:true,issues:[],notification:'not_needed'};
  if(!config.notify)return {healthy:false,issues,notification:'dry_run'};

  // A fixed payload per mode/window also deduplicates changing symptoms and
  // lost provider responses. A new 30-minute window is an intentional reminder.
  const window=Math.floor(now/1800_000),mode=config.environment==='production'?'LIVE':'TEST';
  const payload={from:config.from,to:[config.to],subject:`[ParkShare ${mode}] Emergency alert system needs attention`,
    text:[`ParkShare ${mode} independent alert-system check requires attention.`,
      `Monitoring window: ${new Date(window*1800_000).toISOString()}`,
      'Inspect the authorized monitor workflow and health probe for the current failure codes.',
      'Check worker heartbeat, stalled or blocked notifications and database availability.',
      'This monitor performs no booking, payment, refund, transfer or queue recovery action.'].join('\n')};
  const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const key=`parkshare-alert-health-v1/${config.environment}/${window}/${digest}`;
  let notification='uncertain';
  try {
    const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json','Idempotency-Key':key},
      body:JSON.stringify(payload)});
    if(response.ok){const value=await readJson(response);if(typeof value?.id==='string' && /^[0-9a-f-]{36}$/i.test(value.id))notification='accepted';}
    else if(response.status>=400 && response.status<500 && response.status!==429 && response.status!==409)notification='rejected';
  } catch {}
  return {healthy:false,issues,notification};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const result=await runPaymentAlertMonitor();console.log(JSON.stringify(result));
    if(!result.healthy)process.exitCode=1;
  } catch {console.error('Alert monitor failed.');process.exitCode=1;}
}
