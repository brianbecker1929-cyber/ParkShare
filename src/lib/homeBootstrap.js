// The static homepage matches App's anonymous initial render. Sensitive return
// flows retain their existing client mount, rather than hydrating different UI.
const returnParameters = new Set([
  'message_booking', 'view_booking', 'extend_booking', 'legal',
  'booking_success', 'booking_cancelled', 'extension_success', 'extension_cancelled', 'stripe_onboarding',
  'code', 'token', 'token_hash', 'type', 'access_token', 'refresh_token', 'error', 'error_code', 'error_description',
]);

export function shouldHydrateHomepage({hasServerMarkup, pathname, search = '', hash = ''}) {
  if (!hasServerMarkup || pathname !== '/') return false;
  const parameters = new URLSearchParams(search);
  if ([...parameters.keys()].some(key => returnParameters.has(key.toLowerCase()))) return false;
  // Supabase implicit recovery/verification links carry credentials in the hash.
  return !hash.includes('=');
}
