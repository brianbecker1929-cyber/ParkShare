import { MIN_NEW_PASSWORD_LENGTH } from './authForm.js';

export const RECOVERY_SESSION_CHANGED = 'Your recovery session changed or could not be verified. Close this dialog and reopen your password reset link. If you already submitted, try signing in with the new password before requesting another reset.';
const uncertain = "We couldn't confirm your password update. Try signing in with your new password before requesting another reset.";
const sessionError = () => Object.assign(new Error(RECOVERY_SESSION_CHANGED), { code:'recovery_session_changed' });

// Bind the write to one server-verified bearer token. The shared SDK's
// updateUser() rereads mutable session storage and saves its response there;
// neither behavior is safe for an old recovery form after an account switch.
export async function updateRecoveryPasswordForAccount({
  client, authUrl, publishableKey, expectedAccountId, password,
  isCurrent = () => false, request = (...args) => fetch(...args),
}) {
  if (!isCurrent()) return null;
  if (typeof expectedAccountId !== 'string' || !expectedAccountId.trim()) throw sessionError();
  if (typeof password !== 'string' || password.length < MIN_NEW_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_NEW_PASSWORD_LENGTH} characters`);
  const session = async () => {
    let result;
    try { result = await client.auth.getSession(); }
    catch { if (!isCurrent()) return null; throw sessionError(); }
    if (!isCurrent()) return null;
    const {data,error} = result || {};
    if (error || data?.session?.user?.id !== expectedAccountId || typeof data.session.access_token !== 'string' || !data.session.access_token.trim()) throw sessionError();
    return data.session;
  };
  const captured = await session();
  if (!captured) return null;
  const token = captured.access_token;
  // getSession is a snapshot, not proof that the token belongs to that user.
  let verified;
  try { verified = await client.auth.getUser(token); }
  catch { if (!isCurrent()) return null; throw sessionError(); }
  if (!isCurrent()) return null;
  if (verified?.error || verified?.data?.user?.id !== expectedAccountId) throw sessionError();
  if (!await session() || !isCurrent()) return null;
  const endpoint = new URL('/auth/v1/user', authUrl);
  if (endpoint.protocol !== 'https:' || !publishableKey) throw new Error('Password recovery is temporarily unavailable.');
  let response;
  try {
    response = await request(endpoint.href, {
      method:'PUT', headers:{'Content-Type':'application/json',apikey:publishableKey,Authorization:`Bearer ${token}`},
      credentials:'omit', cache:'no-store', redirect:'error', body:JSON.stringify({password}),
    });
  } catch { if (!isCurrent()) return null; throw new Error(uncertain); }
  if (!isCurrent()) return null;
  const user = await response.json().catch(() => null);
  if (!isCurrent()) return null;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw sessionError();
    throw new Error(user?.msg || user?.message || 'Unable to update your password right now. Please try again.');
  }
  if (user?.id !== expectedAccountId) throw new Error(uncertain);
  if (!await session() || !isCurrent()) return null;
  // No setSession, refreshSession or SDK updateUser: an obsolete reply must
  // never replace another account's shared session or broadcast USER_UPDATED.
  return {data:{user},error:null};
}
