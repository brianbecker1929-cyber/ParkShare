const BUCKET = 'listing-photos';
const PATH = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

// Jobs are inserted by the successful DELETE transaction, never by clients.
// The SQL selector withholds any object still referenced by another listing.
// Storage deletion is idempotent: leave jobs in place until Storage succeeds.
export async function cleanupListingPhotos(admin, { listingId = null, now = Date.now() } = {}) {
  const { data: jobs, error } = await admin.rpc('listing_photo_cleanup_batch', {
    target_listing_id: listingId, batch_limit: 50,
  });
  if (error) throw error;
  if (!jobs?.length) return { processed: 0, pending: false };
  const paths = jobs.map(job => job.object_path);
  if (jobs.some(job => !PATH.test(job.object_path) || !job.object_path.startsWith(`${job.host_id}/`))) {
    throw new Error('Invalid photo cleanup job');
  }
  const removal = await admin.storage.from(BUCKET).remove(paths);
  if (removal.error) {
    const retry = await admin.from('listing_photo_cleanup').update({
      next_attempt_at: new Date(now + 60 * 60_000).toISOString(),
    }).in('object_path', paths);
    if (retry.error) throw retry.error;
    return { processed: 0, pending: true };
  }
  const acknowledgement = await admin.from('listing_photo_cleanup').delete().in('object_path', paths);
  if (acknowledgement.error) throw acknowledgement.error;
  return { processed: paths.length, pending: false };
}
