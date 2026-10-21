import {moneyCents} from './_host-earnings.js';

// Presentation only: status and attribution come from the stored booking,
// not the email audience or Stripe/request metadata. Never changes a refund.
export function refundEmailContext({booking, refund, extension}) {
  const extensionPayment = Boolean(refund.extension_id);
  const cancelled = !extensionPayment && ['refunded','cancelled','canceled'].includes(String(booking.status || '').toLowerCase());
  let partial = false;
  try {
    partial = Number(refund.amount_cents) < moneyCents(extensionPayment ? extension?.added_amount : booking.total);
  } catch { /* Legacy missing totals retain neutral wording, never "full refund". */ }
  const kind = `${partial ? 'partial ' : ''}${extensionPayment ? 'extension refund' : 'refund'}`;
  const actors = {driver:'Driver', host:'Host', support:'ParkShare Support', system:'ParkShare system'};
  const actor = Object.hasOwn(actors, booking.cancelled_by) ? actors[booking.cancelled_by] : 'Not recorded';
  const reason = typeof booking.cancellation_reason === 'string' ? booking.cancellation_reason.trim().slice(0,500) : '';
  return {
    cancelled, partial, extension:extensionPayment,
    headline:cancelled ? `Booking cancelled — ${kind} confirmed` : `${kind[0].toUpperCase()}${kind.slice(1)} confirmed`,
    headerTop:cancelled ? 'BOOKING CANCELLED' : extensionPayment && partial ? 'PARTIAL EXTENSION' : kind.toUpperCase(),
    headerBottom:cancelled ? `${kind.toUpperCase()} CONFIRMED` : extensionPayment && partial ? 'REFUND CONFIRMED' : 'CONFIRMED',
    refundContext:cancelled ? `Cancelled by: ${actor}.`
      : `${partial ? 'Partial refund' : 'Refund'} for ${extensionPayment ? 'an extension payment' : 'the original booking payment'}.`,
    refundReason:cancelled ? reason ? `Cancellation reason: ${reason}` : 'No cancellation reason was recorded.' : '',
    subject:cancelled ? `Booking PK-${booking.id} cancelled — ${kind} confirmed`
      : `${kind[0].toUpperCase()}${kind.slice(1)} confirmed for booking PK-${booking.id}`,
  };
}
