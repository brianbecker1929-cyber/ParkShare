import {cachedHostBookingStatus} from '../src/lib/bookingReadiness.js';

// Bounded second lookup for the current discovery page only. Host identity,
// account IDs and verification flags never leave this server-side helper.
export async function publicListingBookability(admin, listingIds) {
  const ids = [...new Set(listingIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 50);
  const result = new Map(ids.map(id => [id, 'unknown']));
  if (!ids.length) return result;
  try {
    const response = await admin.from('listings').select('id,profiles(role,stripe_account_id,stripe_onboarding_complete,stripe_charges_enabled,stripe_payouts_enabled)').in('id', ids);
    if (response.error || !Array.isArray(response.data)) return result;
    for (const row of response.data) {
      if (!result.has(Number(row.id))) continue;
      const host = Array.isArray(row.profiles) ? row.profiles.length === 1 ? row.profiles[0] : undefined : row.profiles;
      result.set(Number(row.id), host === undefined ? 'unknown' : cachedHostBookingStatus(host));
    }
  } catch { /* A failed secondary read is unknown, never an invented ready flag. */ }
  return result;
}

// Public detail checks share a short-lived, bounded, process-local boolean cache
// so visitors to one Host's listings don't multiply provider account reads.
// Checkout still independently retrieves Stripe's current account every time.
export function createAccountBookabilityReader(stripe, {ttlMs = 10_000, maxEntries = 128, now = Date.now} = {}) {
  const cache = new Map();
  return accountId => {
    const existing = cache.get(accountId);
    if (existing?.pending) return existing.pending;
    if (existing && existing.expires > now()) return Promise.resolve(existing.status);
    cache.delete(accountId);
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    const entry = {};
    cache.set(accountId, entry);
    entry.pending = Promise.resolve().then(() => stripe.accounts.retrieve(accountId)).then(account => {
      if (!account || account.id !== accountId) throw new Error('Account status could not be verified');
      const flags = ['details_submitted', 'charges_enabled', 'payouts_enabled'].map(key => account[key]);
      if (!account.deleted && !flags.every(value => typeof value === 'boolean')) throw new Error('Account status could not be verified');
      entry.status = !account.deleted && flags.every(value => value === true) ? 'ready' : 'not_ready';
      entry.expires = now() + ttlMs;
      return entry.status;
    }).catch(error => {if (cache.get(accountId) === entry) cache.delete(accountId); throw error;})
      .finally(() => {delete entry.pending;});
    return entry.pending;
  };
}
