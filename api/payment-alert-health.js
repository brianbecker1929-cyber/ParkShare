// Read-only probe. Its separate credential cannot run any financial/email worker.
import {timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {getPaymentAlertHealth} from './_payment-alert-health.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control','private, no-store');
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const secret = process.env.PAYMENT_ALERT_MONITOR_SECRET;
  if (!secret || secret.length < 32 || secret === process.env.CRON_SECRET) return res.status(503).json({error:'Health probe is not configured.'});
  const expected = Buffer.from(`Bearer ${secret}`), supplied = req.headers.authorization;
  if (typeof supplied !== 'string') return res.status(401).json({error:'Unauthorized'});
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) return res.status(401).json({error:'Unauthorized'});
  const probe = req.headers['x-parkshare-health-probe'];
  if (typeof probe !== 'string' || !/^[0-9a-f-]{36}$/i.test(probe)) return res.status(400).json({error:'Probe reference required'});
  try {
    const db = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
      {auth:{persistSession:false,autoRefreshToken:false}});
    const result = await getPaymentAlertHealth({db,probe});
    return res.status(result.healthy ? 200 : 503).json(result);
  } catch {return res.status(503).json({error:'Health probe is unavailable.'});}
}
