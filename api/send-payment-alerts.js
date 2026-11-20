// Separate email-only drain. No booking/payment/refund worker is invoked.
import {timingSafeEqual} from 'node:crypto';
import {supabaseAdmin} from './_lib.js';
import {drainPaymentAlerts} from './_payment-alert-worker.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({error: 'Method not allowed'});
  if (!process.env.CRON_SECRET) return res.status(503).json({error: 'Alert worker is not configured.'});
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET}`), actual = Buffer.from(req.headers.authorization || '');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.status(401).json({error: 'Unauthorized'});
  try {
    const result = await drainPaymentAlerts({db: supabaseAdmin});
    if (!result.enabled) return res.status(503).json({error: 'Alert worker is disabled or not configured.'});
    return res.status(result.failed ? 503 : 200).json(result);
  } catch {
    return res.status(503).json({error: 'Alert processing queue is unavailable.'});
  }
}
