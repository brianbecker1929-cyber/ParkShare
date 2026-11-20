export function validateHostProfile(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalised = {name: typeof input.name === 'string' ? input.name.trim() : '', phone: typeof input.phone === 'string' ? input.phone.trim() : ''};
  const errors = {};
  if (normalised.name.length < 2 || normalised.name.length > 80) errors.name = 'Enter a name between 2 and 80 characters.';
  if (typeof input.phone !== 'string' || normalised.phone.length > 30 || normalised.phone && !/^[+\d\s().-]+$/.test(normalised.phone)
      || normalised.phone && !/^\d{10,15}$/.test(normalised.phone.replace(/\D/g, ''))) errors.phone = 'Enter a complete phone number, including area code, or leave it blank.';
  return {normalised, errors, valid: Object.keys(errors).length === 0};
}

export function hostProfilePayload(profile, user) {
  return {id: user.id, role: 'host', name: typeof profile.name === 'string' ? profile.name : '',
    phone: typeof user.user_metadata?.phone === 'string' ? user.user_metadata.phone : '', email: typeof user.email === 'string' ? user.email : ''};
}

const uncertain = "We couldn't confirm your saved profile. Reload the profile to check before saving again.";
export async function requestHostProfile(client, {accountId, isCurrent, signal, profile}, request = fetch) {
  const currentSession = async () => {
    let result;
    try { result = await client.auth.getSession(); }
    catch { if (!isCurrent()) return null; throw new Error('Your account could not be verified. Sign in again to open your Host profile.'); }
    if (!isCurrent()) return null;
    const session = result?.data?.session;
    if (result?.error || !session?.access_token || session.user?.id !== accountId) throw new Error('Your account changed or expired. Sign in again to open your Host profile.');
    return session;
  };
  if (!isCurrent()) return null;
  const saving = profile !== undefined;
  const snapshot = saving ? validateHostProfile(profile) : null;
  if (saving && !snapshot.valid) throw Object.assign(new Error('Check the highlighted fields.'), {fieldErrors: snapshot.errors});
  const session = await currentSession();
  if (!session || !isCurrent()) return null;
  let response;
  try {
    response = await request('/api/host-profile', {method: saving ? 'PATCH' : 'GET', cache: 'no-store', signal,
      headers: {Authorization: `Bearer ${session.access_token}`, ...(saving ? {'Content-Type': 'application/json'} : {})},
      ...(saving ? {body: JSON.stringify(snapshot.normalised)} : {})});
  } catch {
    if (!isCurrent()) return null;
    throw new Error(saving ? uncertain : 'Your Host profile could not load. Please retry.');
  }
  if (!isCurrent()) return null;
  const payload = await response.json().catch(() => null);
  if (!isCurrent()) return null;
  if (!response.ok) {
    const error = new Error(saving ? uncertain : 'Your Host profile could not load. Please retry or sign in again.');
    if (response.status === 400 && payload?.errors) error.fieldErrors = Object.fromEntries(['name', 'phone'].filter(key => typeof payload.errors[key] === 'string').map(key => [key, payload.errors[key]]));
    throw error;
  }
  const result = payload?.profile;
  if (!result || result.id !== accountId || result.role !== 'host' || !['name', 'phone', 'email'].every(key => typeof result[key] === 'string')
      || saving && !validateHostProfile(result).valid) throw new Error(saving ? uncertain : 'Your Host profile could not be confirmed. Please retry.');
  if (!await currentSession() || !isCurrent()) return null;
  return {id: accountId, name: result.name, phone: result.phone, email: result.email};
}
