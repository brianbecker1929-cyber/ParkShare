// Database FK RESTRICT protects bookings/holds; successful deletions enqueue
// photo cleanup atomically. The server starts Storage cleanup with retries.
export function listingDeletionFailureMessage(error) {
  const code = String(error?.code || '');
  if (code === '23503') return 'This driveway has bookings or checkout reservations and cannot be deleted. No reservation was removed.';
  if (code === '42501' || code === 'PGRST301') return 'Your account is not authorized to delete this listing. Please sign in as its Host.';
  return "Couldn't delete listing. Please try again or contact ParkShare support.";
}

export async function deleteHostListing(supabase, { listingId, hostId, isContextCurrent = () => false }, request = fetch) {
  const id = Number(listingId);
  if (!Number.isSafeInteger(id) || id <= 0 || !hostId) return { ok: false, message: 'Invalid listing or Host account. Nothing was deleted.' };
  const obsolete = () => ({ ok: false, obsolete: true });
  if (!isContextCurrent()) return obsolete();
  try {
    const { data, error } = await supabase.auth.getSession();
    if (!isContextCurrent()) return obsolete();
    if (error || !data?.session?.access_token) return { ok: false, message: 'Sign in as the Host to delete this listing.' };
    if (data.session.user?.id !== hostId) return { ok: false, message: 'Your account changed. Reopen this listing as its Host before deleting.' };
    if (!isContextCurrent()) return obsolete();
    const response = await request('/api/delete-listing', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ listingId: id }),
    });
    const result = await response.json();
    if (!isContextCurrent()) return obsolete();
    if (!response.ok || !result.deleted) return { ok: false, message: result.error || 'The listing was not deleted. Please try again.' };
    return { ok: true, photoCleanupPending: Boolean(result.photoCleanupPending) };
  } catch {
    if (!isContextCurrent()) return obsolete();
    // The response could have been lost after the deletion committed. Do not
    // promise "nothing deleted" when its actual outcome is unknown.
    return { ok: false, message: 'Unable to confirm deletion. Refresh your listings before trying again.' };
  }
}
