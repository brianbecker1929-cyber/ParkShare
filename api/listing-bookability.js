import {jsonMethod, supabaseAdmin, stripe} from './_lib.js';
import {createAccountBookabilityReader} from './_listing-bookability.js';
const accountStatus = createAccountBookabilityReader(stripe);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!jsonMethod(req, res, 'GET')) return;
  const raw = req.query?.listingId;
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) return res.status(400).json({error: 'Invalid listing.'});
  try {
    const found = await supabaseAdmin.from('listings').select('host_id').eq('id', Number(raw)).maybeSingle();
    if (found.error) throw found.error;
    if (!found.data) return res.status(404).json({error: 'Listing not found.'});
    const host = await supabaseAdmin.from('profiles').select('role,stripe_account_id').eq('id', found.data.host_id).maybeSingle();
    if (host.error) throw host.error;
    if (host.data?.role !== 'host' || !host.data.stripe_account_id) return res.status(200).json({bookingStatus: 'not_ready'});
    const bookingStatus = await accountStatus(host.data.stripe_account_id);
    return res.status(200).json({bookingStatus});
  } catch (error) {
    console.warn('[listing-bookability] check unavailable', {code: error?.code});
    return res.status(503).json({bookingStatus: 'unknown', error: 'Booking status could not be confirmed. Please try again.'});
  }
}
