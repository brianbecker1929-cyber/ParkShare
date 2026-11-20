import {evaluateCancellation} from './_cancellation-policy.js';
import {cancellationReasonFor, isParkShareStaff} from '../src/lib/cancellationReasons.js';

// Validate caller-controlled intent separately from mutable booking balances.
// A retry must be identified before applying eligibility for a NEW refund.
export function refundRequestIntent({user, booking, hostId, body}) {
  const actor = isParkShareStaff(user) ? 'staff' : booking.renter_id === user.id ? 'driver' : hostId === user.id ? 'host' : null;
  if (!actor) return {error: 'You cannot refund this booking.', status: 403};
  // Reject financial authority fields rather than silently trusting a caller.
  if (['feePayer', 'fee_payer', 'actor', 'role', 'processingFee', 'reimbursementCents'].some(key => Object.hasOwn(body, key))) {
    return {error: 'Refund responsibility is determined by ParkShare.', status: 400};
  }
  const action = body.action || 'cancel';
  if (!['cancel', 'refund'].includes(action) || actor === 'driver' && action !== 'cancel') return {error: 'Invalid refund action.', status: 400};
  const reason = cancellationReasonFor(actor, body.reasonCode, action);
  if (!reason) return {error: 'This cancellation reason is not permitted for your account.', status: 403};
  const explanation = String(body.explanation || '').trim();
  if (explanation.length > 1000 || reason.explanation && explanation.length < 3) return {error: 'Please provide an explanation (3–1000 characters).', status: 400};
  if (action === 'refund') {
    if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) return {error: 'Enter a valid partial refund amount below the remaining payment.', status: 400};
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(body.requestId || '')) return {error: 'A refund request ID is required.', status: 400};
  }
  return {actor, action, reason, explanation, requestKey: action === 'cancel' ? `cancel-${booking.id}` : `partial-${body.requestId}`};
}

export function decideRefund({user, booking, hostId, body, now = new Date()}) {
  const intent = refundRequestIntent({user, booking, hostId, body});
  if (intent.error) return intent;
  const {actor, action, reason, explanation} = intent;
  const eligibility = evaluateCancellation({booking, userId: user.id, hostId, now});
  if (reason.payer === 'review') return {actor, action, reason, explanation, review: true};
  if (actor !== 'staff' && action === 'cancel' && !eligibility.allowed) return {error: eligibility.message, code: eligibility.code, status: eligibility.code === 'forbidden' ? 403 : 409};
  if (actor === 'staff' && reason.code === 'staff_driver_eligible') {
    const driverEligibility = evaluateCancellation({booking, userId: booking.renter_id, hostId, now});
    if (!driverEligibility.allowed || driverEligibility.idempotent) return {error: 'This is not an eligible free Driver cancellation. Use an approved staff exception if appropriate.', status: 409};
  }
  if (actor !== 'staff' && action === 'cancel' && eligibility.idempotent) return {actor, action, reason, explanation, existing: true};
  if (!['confirmed', 'completed'].includes(booking.status) || !booking.paid_at) return {error: 'Only paid, confirmed or completed bookings can be refunded.', status: 409};
  const gross = Math.round(Number(booking.total) * 100);
  const remaining = gross - Math.round(Number(booking.refund_total_amount || 0) * 100);
  if (Number(booking.refund_pending_amount) > 0 || ['pending', 'requires_action'].includes(booking.refund_status)) return {error: 'A refund is already pending. Wait for it to settle.', status: 409};
  const amount = action === 'cancel' ? remaining : body.amountCents;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining || action === 'refund' && amount >= remaining) return {error: 'Enter a valid partial refund amount below the remaining payment.', status: 400};
  return {...intent, amount, gross};
}

export function originalProcessingFee(charge, booking, livemode) {
  const tx = charge.balance_transaction;
  if (charge.payment_intent !== booking.stripe_payment_intent_id || charge.id !== booking.stripe_charge_id
    || charge.livemode !== livemode || charge.currency !== 'cad' || charge.amount !== Math.round(Number(booking.total) * 100)
    || charge.paid !== true || charge.captured !== true || charge.status !== 'succeeded' || charge.disputed
    || !tx || typeof tx !== 'object' || tx.currency !== 'cad' || tx.source !== charge.id || !Array.isArray(tx.fee_details)) {
    throw new Error('payment_identity_or_processing_fee_unverified');
  }
  // Application fees, FX, tax and Connect fees are not processing fees.
  const fees = tx.fee_details.filter(f => f.type === 'stripe_fee');
  if (fees.some(f => f.currency !== 'cad' || !Number.isSafeInteger(f.amount) || f.amount < 0)) throw new Error('processing_fee_unverified');
  const fee = fees.reduce((sum, f) => sum + f.amount, 0);
  if (!Number.isSafeInteger(fee) || fee > charge.amount) throw new Error('processing_fee_unverified');
  return fee;
}
