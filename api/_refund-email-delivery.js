import { createHash } from 'node:crypto';
import { buildEmailPayload, sendEmailPayload, refundConfirmedHtml } from './_email.js';
import { getSessionWindow } from './_booking-rules.js';
import { formatBookingEmailTimes } from './_booking-email-times.js';
import { SUPPORT_EMAIL } from '../src/lib/supportContact.js';

function checked(result, step) {
  if (result.error) throw new Error(`Refund notification ${step} failed`);
  return result.data;
}

async function prepareMessage(db, job, refund) {
  const booking = checked(await db.from('bookings')
    .select('id, listing_id, renter_id, status, hours, paid_at, booking_date, start_hour, scheduled_starts_at, property_time_zone, spot_label, vehicle_make, vehicle_model, vehicle_colour, license_plate, stripe_connected_account_id, stripe_payment_intent_id')
    .eq('id', job.booking_id).single(), 'booking lookup');
  if (!booking || !booking.paid_at) throw new Error('Refund notification booking unavailable');
  if (refund.extension_id) {
    const extension = checked(await db.from('booking_extensions').select('booking_id,stripe_connected_account_id,stripe_payment_intent_id')
      .eq('id',refund.extension_id).single(), 'extension lookup');
    if (!extension || extension.booking_id !== booking.id || extension.stripe_connected_account_id !== refund.connected_account_id
        || extension.stripe_payment_intent_id !== refund.payment_intent_id) throw new Error('Refund notification extension owner mismatch');
  } else if (refund.booking_id !== booking.id || booking.stripe_connected_account_id !== refund.connected_account_id
      || booking.stripe_payment_intent_id !== refund.payment_intent_id) throw new Error('Refund notification booking owner mismatch');
  const listing = checked(await db.from('listings').select('host_id,address').eq('id',booking.listing_id).single(), 'listing lookup');
  const recipientId = job.audience === 'host' ? listing?.host_id : booking.renter_id;
  if (!recipientId) throw new Error('Refund notification recipient unavailable');
  const recipient = checked(await db.from('profiles').select('name,email').eq('id',recipientId).single(), 'recipient lookup');
  if (!recipient?.email?.trim()) throw new Error('Refund notification email unavailable');
  const {start,end} = getSessionWindow(booking);
  const times = formatBookingEmailTimes(start,end,new Date(),booking.property_time_zone || 'UTC');
  const cancelled = ['refunded','cancelled','canceled'].includes(booking.status);
  const outcome = cancelled ? 'This booking is cancelled. It no longer reserves a parking space.'
    : booking.status === 'confirmed' ? 'Your booking remains confirmed. Check your booking for the current departure time.'
    : booking.status === 'completed' ? 'This booking has completed.'
    : 'Check your booking for its current status. This refund receipt does not confirm a reservation.';
  const html = refundConfirmedHtml({
    audience:job.audience,recipientName:recipient.name,amountCents:Number(refund.amount_cents),
    refundId:refund.refund_id,bookingId:booking.id,extension:Boolean(refund.extension_id),
    address:listing?.address,spotLabel:booking.spot_label,
    vehicleDetails:[booking.vehicle_make,booking.vehicle_model,booking.vehicle_colour,booking.license_plate].filter(Boolean).join(' · '),
    sessionStart:`${times.entryDateFull}, ${times.startTimeStr}`,sessionEnd:`${times.exitDateFull}, ${times.endTimeStr}`,
    timeZoneLabel:times.timeZoneLabel,bookingOutcome:outcome,supportEmail:process.env.SUPPORT_EMAIL || SUPPORT_EMAIL,
  });
  return buildEmailPayload({to:recipient.email.trim(),subject:cancelled
    ? `Booking PK-${booking.id} cancelled — refund confirmed` : `Refund confirmed for booking PK-${booking.id}`,html});
}

export async function processRefundEmail(db, job, {now = new Date(), send = sendEmailPayload} = {}) {
  const table = () => db.from('refund_email_deliveries');
  const claimed = checked(await table().update({lease_until:new Date(now.getTime()+120_000).toISOString()})
    .eq('id',job.id).is('sent_at',null).is('blocked_at',null).lte('lease_until',now.toISOString())
    .select('id,connected_account_id,livemode,refund_id,booking_id,audience,payload,first_attempt_at').maybeSingle(), 'claim');
  if (!claimed) return 'busy';
  job = claimed;
  const refund = checked(await db.from('payment_refunds')
    .select('connected_account_id,livemode,refund_id,booking_id,extension_id,payment_intent_id,currency,amount_cents,status')
    .eq('connected_account_id',job.connected_account_id).eq('livemode',job.livemode).eq('refund_id',job.refund_id).single(), 'verified refund lookup');
  if (!refund || refund.status !== 'succeeded') {
    checked(await table().update({blocked_at:now.toISOString()}).eq('id',job.id), 'suppression');
    return 'blocked';
  }
  if (refund.currency !== 'cad' || !Number.isSafeInteger(Number(refund.amount_cents)) || Number(refund.amount_cents)<=0) throw new Error('Refund notification amount invalid');
  if (!job.payload) {
    const payload = await prepareMessage(db,job,refund);
    checked(await table().update({payload,first_attempt_at:now.toISOString()}).eq('id',job.id).is('payload',null), 'snapshot');
    job = checked(await table().select('id,payload,first_attempt_at').eq('id',job.id).single(), 'saved snapshot');
  }
  if (now.getTime()-Date.parse(job.first_attempt_at)>=23*3600_000) {
    checked(await table().update({blocked_at:now.toISOString()}).eq('id',job.id), 'retry deadline');
    return 'blocked'; // Reconcile provider acceptance before retrying after its 24h key cache.
  }
  const scope = createHash('sha256').update(`${process.env.SUPABASE_URL}|${job.id}`).digest('hex');
  const accepted = await send(job.payload,{idempotencyKey:`parkshare-refund-${scope}`});
  if (!accepted?.id || accepted.skipped) throw new Error('Refund notification was not accepted');
  checked(await table().update({provider_id:accepted.id,sent_at:new Date().toISOString()}).eq('id',job.id), 'acceptance');
  return 'sent';
}
