export function cachedHostBookingStatus(profile) {
  if (!profile || profile.role !== 'host' || !profile.stripe_account_id) return 'not_ready';
  const flags = ['stripe_onboarding_complete', 'stripe_charges_enabled', 'stripe_payouts_enabled'].map(key => profile[key]);
  if (flags.every(value => value === true)) return 'ready';
  if (flags.some(value => value === false)) return 'not_ready';
  return 'unknown';
}

export function normalizeBookingStatus(value) {
  return ['ready', 'not_ready'].includes(value) ? value : 'unknown';
}

export function bookingReadinessMessage(status) {
  if (status === 'not_ready') return 'This listing is not bookable yet. The Host needs to finish payment setup. Please choose another parking space.';
  if (status === 'checking') return 'Checking whether this listing can accept bookings…';
  return 'Booking status could not be confirmed. Please try again.';
}
