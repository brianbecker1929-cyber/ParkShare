import {validateHourlyRate} from './listingPrice.js';
const LIMIT = 256;
const rowId = value => {
  const id = typeof value === 'string' && value.startsWith('db-') ? Number(value.slice(3)) : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
function browserStorage() {try {return globalThis.sessionStorage;} catch {return null;}}

// A confirmed permanent deletion must not be undone by an older dashboard read.
// Persist IDs only, scoped to this Host/tab, so an immediate reload is safe too.
export function createHostListingJournal(accountId, storage = browserStorage()) {
  const key = accountId ? `parkshare:deleted-listings:${accountId}` : null;
  let removed = new Set(), version = 0;
  const saved = new Map(), unavailable = new Set();
  try {
    const raw = key && storage?.getItem(key);
    const ids = raw && raw.length <= 20_000 ? JSON.parse(raw) : [];
    if (Array.isArray(ids)) removed = new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0).slice(-LIMIT));
  } catch { /* Storage is optional; in-memory reconciliation still applies. */ }
  return {
    get version() {return version;},
    remove(value) {
      const id = rowId(value); if (!key || id === null) return;
      removed.add(id); saved.delete(id);
      if (removed.size > LIMIT) removed.delete(removed.values().next().value);
      try {storage?.setItem(key, JSON.stringify([...removed]));} catch { /* Keep current-page state. */ }
    },
    hide(value) {const id = rowId(value); if (key && id !== null) unavailable.add(id);},
    save(value, changes) {
      const id = rowId(value); if (!key || id === null || removed.has(id)) return;
      const {price, description, features, spots, spaces} = changes;
      const settings = {...(typeof changes.title === 'string' ? {title:changes.title} : {}),
        ...(typeof changes.is_paused === 'boolean' ? {is_paused:changes.is_paused,active:!changes.is_paused} : {}),
        ...(changes.availability ? {availability:changes.availability} : {})};
      saved.set(id, {version: ++version, changes: structuredClone({price, description, features, spots, spaces,...settings})});
      if (saved.size > LIMIT) saved.delete(saved.keys().next().value);
    },
    reconcile(rows, readVersion = 0) {
      return rows.filter(row => !removed.has(rowId(row.id)) && !unavailable.has(rowId(row.id))).map(row => {
        const entry = saved.get(rowId(row.id));
        return entry && entry.version > readVersion ? {...row, ...structuredClone(entry.changes)} : row;
      });
    },
  };
}
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
export function listingSettingsMatch(row, changes) {
  if (typeof changes.title === 'string' && row.title !== changes.title || typeof changes.is_paused === 'boolean' && row.is_paused !== changes.is_paused) return false;
  return !changes.availability || JSON.stringify(sorted(row.availability)) === JSON.stringify(sorted(changes.availability));
}
export function listingEditMatches(row, changes) {
  const rate = validateHourlyRate(row?.price);
  if (!rate.valid || rate.value !== changes.price || Number(row.spaces) !== changes.spaces || (row.description || '') !== changes.description) return false;
  return listingSettingsMatch(row, changes) && ['features','spots'].every(key => JSON.stringify(sorted(row[key])) === JSON.stringify(sorted(changes[key])));
}
