import {randomUUID} from 'node:crypto';
import {reportPaymentAlert} from './_payment-alerts.js';
const DAY = 24 * 60 * 60 * 1000;
const stripeId = value => typeof value === 'string' ? value : value?.id;
export async function processBookingRefund({db, stripe, id, livemode, now = new Date(), notify = reportPaymentAlert}) {
  const token = randomUUID();
  const {data: claimed, error: claimError} = await db.rpc('claim_booking_refund', {p_id: id, p_token: token});
  if (claimError) throw claimError;
  if (!claimed) return 'busy';
  let op = claimed;
  const patch = async values => {
    const {error} = await db.from('booking_refund_operations').update(values).eq('id', id).eq('lease_token', token);
    if (error) throw error;
    op = {...op, ...values};
  };
  const review = async code => {
    await patch({state: 'review', review_code: code});
    await notify('refund_needs_review', {operationId: op.id, bookingId: Number(op.booking_id),
      connectedAccountId: op.connected_account_id, livemode: op.livemode});
    return 'review';
  };
  const opts = {stripeAccount: op.connected_account_id, timeout: 8000, maxNetworkRetries: 0};
  try {
    if (op.livemode !== livemode) return await review('stripe_mode_mismatch');
    if (!op.refund_id && +now - Date.parse(op.refund_attempt_at) >= DAY) return await review('refund_idempotency_window_expired');
    // Refund objects do not expose livemode. Verify the original charge in
    // the operation's connected-account context before any financial write.
    const charge = await stripe.charges.retrieve(op.charge_id, {}, opts);
    if (charge?.object !== 'charge' || charge.id !== op.charge_id
      || stripeId(charge.payment_intent) !== op.payment_intent_id || charge.livemode !== livemode
      || charge.currency !== op.currency || charge.amount !== Number(op.gross_cents)
      || charge.paid !== true || charge.captured !== true || charge.status !== 'succeeded' || charge.disputed) {
      return await review('refund_payment_identity_mismatch');
    }
    const refund = op.refund_id
      ? await stripe.refunds.retrieve(op.refund_id, {}, opts)
      : await stripe.refunds.create({
        payment_intent: op.payment_intent_id, amount: op.amount_cents, reason: 'requested_by_customer', refund_application_fee: true,
        metadata: {booking_id: String(op.booking_id), parkshare_operation: op.id, parkshare_reason: op.reason_code},
      }, {...opts, idempotencyKey: `parkshare-refund-${op.id}`});
    if (refund?.object !== 'refund' || typeof refund.id !== 'string' || !/^re_[A-Za-z0-9_]+$/.test(refund.id)
      || stripeId(refund.payment_intent) !== op.payment_intent_id || stripeId(refund.charge) !== op.charge_id
      || refund.currency !== op.currency || refund.amount !== Number(op.amount_cents)
      || (op.refund_id && refund.id !== op.refund_id)) return await review('refund_identity_mismatch');
    await patch({refund_id: refund.id, refund_status: refund.status});
    if (['failed', 'canceled'].includes(refund.status)) return await review('customer_refund_failed');
    if (refund.status !== 'succeeded') return 'pending';
    const {data: ledger, error} = await db.from('payment_refunds').select('status,amount_cents,booking_id')
      .eq('connected_account_id', op.connected_account_id).eq('livemode', livemode).eq('refund_id', refund.id).maybeSingle();
    if (error) throw error;
    if (!ledger || ledger.status !== 'succeeded') return 'pending';
    if (Number(ledger.booking_id) !== Number(op.booking_id) || Number(ledger.amount_cents) !== Number(op.amount_cents)) return await review('refund_ledger_mismatch');
    const allocated = await db.rpc('allocate_refund_fee_credit', {p_id: id, p_token: token});
    if (allocated.error) throw allocated.error;
    op = allocated.data;
    if (op.fee_credit_cents > 0 && !op.transfer_id) {
      if (op.transfer_attempt_at && +now - Date.parse(op.transfer_attempt_at) >= DAY) return await review('transfer_idempotency_window_expired');
      if (!op.transfer_attempt_at) await patch({transfer_attempt_at: now.toISOString()});
      const transfer = await stripe.transfers.create({
        amount: Number(op.fee_credit_cents), currency: op.currency, destination: op.connected_account_id,
        description: 'ParkShare refund processing fee reimbursement',
        metadata: {booking_id: String(op.booking_id), parkshare_operation: op.id, refund_id: refund.id},
      }, {idempotencyKey: `parkshare-fee-credit-${op.id}`, timeout: 8000, maxNetworkRetries: 0});
      if (transfer.amount !== Number(op.fee_credit_cents) || transfer.currency !== op.currency
        || transfer.destination !== op.connected_account_id || transfer.livemode !== livemode || transfer.reversed) return await review('transfer_identity_mismatch');
      await patch({transfer_id: transfer.id});
    }
    await patch({state: 'complete', review_code: null});
    return 'complete';
  } catch (error) {
    console.error('booking-refund-operation: retry required', id, error?.code || 'provider_or_database_error');
    await notify('refund_retry_required', {operationId: op.id, bookingId: Number(op.booking_id),
      connectedAccountId: op.connected_account_id, livemode: op.livemode});
    return 'pending';
  }
}
export async function drainBookingRefunds({db, stripe, livemode, limit = 5}) {
  const {data, error} = await db.from('booking_refund_operations').select('id').eq('livemode', livemode)
    .eq('state', 'queued').lte('lease_until', new Date().toISOString()).order('created_at').limit(limit);
  if (error) throw error;
  const counts = {complete: 0, pending: 0, busy: 0, review: 0};
  for (const job of data || []) counts[await processBookingRefund({db, stripe, id: job.id, livemode})]++;
  return counts;
}
