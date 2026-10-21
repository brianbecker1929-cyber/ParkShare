// Service-only cron drains successful-refund notifications queued by the ledger.
import {timingSafeEqual} from 'node:crypto';
import {supabaseAdmin} from './_lib.js';
import {processRefundEmail} from './_refund-email-delivery.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  if (req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
  if (!process.env.CRON_SECRET) return res.status(503).json({error:'Notification service is not configured.'});
  const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET}`);
  const actual = Buffer.from(req.headers.authorization || '');
  if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) return res.status(401).json({error:'Unauthorized'});
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return res.status(503).json({error:'Notification email is not configured.'});
  const now = new Date();
  const livemode = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '');
  const {data,error} = await supabaseAdmin.from('refund_email_deliveries').select('id')
    .eq('livemode',livemode).is('sent_at',null).is('blocked_at',null).lte('lease_until',now.toISOString())
    .order('created_at').limit(10);
  if (error) return res.status(500).json({error:'Could not load pending refund notifications.'});
  const results = {sent:0,busy:0,blocked:0,failed:0};
  for (const job of data || []) {
    try { results[await processRefundEmail(supabaseAdmin,job)]++; }
    catch { results.failed++; console.error('refund-notifications: delivery failed',job.id); }
  }
  console.info('refund-notifications: completed',JSON.stringify(results));
  return res.status(200).json(results);
}
