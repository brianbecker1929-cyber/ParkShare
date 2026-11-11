import {createHash} from 'node:crypto';
import {sendEmail} from './_email.js';

// This timestamp means provider acceptance of the Driver confirmation,
// not delivery to an inbox or success of the separate Host notification.
export async function sendDriverBookingConfirmation(db, booking, payload, {send = sendEmail, now = () => new Date()} = {}) {
  const {data, error} = await db.from('bookings').select('confirmation_email_sent_at')
    .eq('id', booking.id).eq('renter_id', booking.renter_id).single();
  if (error || !data) throw new Error('Unable to check booking confirmation acceptance');
  if (data.confirmation_email_sent_at) return 'already_sent';
  const scope = createHash('sha256').update(`${process.env.SUPABASE_URL}|${booking.id}|driver`).digest('hex');
  const accepted = await send(payload, {idempotencyKey: `parkshare-booking-confirmation-${scope}`});
  if (accepted?.skipped || typeof accepted?.id !== 'string' || !accepted.id.trim()) {
    throw new Error('Driver booking confirmation was not accepted');
  }
  const saved = await db.from('bookings').update({confirmation_email_sent_at: now().toISOString()})
    .eq('id', booking.id).eq('renter_id', booking.renter_id).is('confirmation_email_sent_at', null).select('id').maybeSingle();
  if (saved.error || !saved.data) throw new Error('Unable to record booking confirmation acceptance');
  return 'sent';
}
