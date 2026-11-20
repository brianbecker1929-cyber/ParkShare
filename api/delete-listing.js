import { jsonMethod, requireUser, supabaseAdmin } from './_lib.js';
import { cleanupListingPhotos } from './_listing-photo-cleanup.js';
import { listingDeletionFailureMessage } from '../src/lib/listingDeletion.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!jsonMethod(req, res, 'POST')) return;
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const id = Number(req.body?.listingId);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid listing.' });
    const role = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (role.error) throw role.error;
    if (role.data?.role !== 'host') return res.status(403).json({ error: 'Only Hosts can delete listings.' });
    // FK RESTRICT remains authoritative: no booking COUNT and no deletion of
    // paid, refunded, or in-flight checkout records to make the DELETE succeed.
    const result = await supabaseAdmin.from('listings').delete().eq('id', id).eq('host_id', user.id).select('id');
    if (result.error) {
      if (result.error.code === '23503') return res.status(409).json({ error: listingDeletionFailureMessage(result.error) });
      throw result.error;
    }
    if (!result.data?.some(row => Number(row.id) === id)) return res.status(404).json({ error: 'Listing not found or not owned by this Host.' });
    let photoCleanupPending = false;
    try { photoCleanupPending = (await cleanupListingPhotos(supabaseAdmin, { listingId: id })).pending; }
    catch { photoCleanupPending = true; console.warn('Listing deleted; durable photo cleanup awaits retry.'); }
    return res.status(200).json({ deleted: true, photoCleanupPending });
  } catch {
    return res.status(500).json({ error: 'Unable to delete this listing right now. Please try again.' });
  }
}
