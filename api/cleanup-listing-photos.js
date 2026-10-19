import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from './_lib.js';
import { cleanupListingPhotos } from './_listing-photo-cleanup.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  const supplied = Buffer.from(req.headers.authorization || '');
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await cleanupListingPhotos(supabaseAdmin);
    return res.status(result.pending ? 503 : 200).json(result);
  } catch {
    return res.status(503).json({ error: 'Photo cleanup will retry on the next run.' });
  }
}
