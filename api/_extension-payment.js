// Inspect current, account-scoped money before granting any extension time.
// A succeeded PaymentIntent can still have a fully refunded Charge.
import {stripeObjectId} from './_refund-rules.js';
import {readRegisteredCheckoutPayment} from './_checkout-payment.js';
export const readExtensionPayment=({pending,...args})=>readRegisteredCheckoutPayment({...args,registration:pending});

export async function rejectExtensionPayment({event,pending,stripe,db,payment,reconcile}) {
  const session=event.data.object, account=event.account;
  const money=payment||await readExtensionPayment({session,account,pending,stripe});
  // Durable rejection serializes with atomic application BEFORE issuing money
  // movement. An already-applied extension fails here, with no automatic refund.
  await recordRejectedExtension({event, pending, db, payment:money});
  // Never duplicate an existing settled/pending refund or refund a dispute.
  // Preserve the historical integrity-reject key and request parameters.
  if(!money.hasReversal) await stripe.refunds.create({
    payment_intent:money.pi,reason:'requested_by_customer',refund_application_fee:true,
    metadata:{parkshare_reason:'invalid_registered_checkout',checkout_session_id:session.id},
  },{stripeAccount:account,idempotencyKey:`integrity-reject-${session.id}`});
  if(money.charge.disputed!==true || money.history.length) {
    await reconcile({event,stripe,db});
  }
}

export async function recordRejectedExtension({event, db, payment:money}) {
  const session=event.data.object, account=event.account;
  const {error}=await db.rpc('record_rejected_booking_extension',{
    p_checkout_session_id:session.id,p_payment_intent_id:money.pi,p_charge_id:money.chargeId,
    p_connected_account_id:account,p_gross_cents:money.gross,
    p_paid_at:new Date((session.created||event.created)*1000).toISOString(),
  });
  if(error) throw error;
 }

// A redelivered historical integrity-refund event can repair its missing
// audit row using the trusted registration plus current Stripe evidence.
// This path NEVER creates a refund or changes booking hours.
export async function recoverRejectedExtensionRefund({event,stripe,db}) {
  if(!['refund.created','refund.updated','refund.failed'].includes(event.type)) return;
  const refundId=event.data?.object?.id;
  if(!/^re_[A-Za-z0-9_]+$/.test(refundId||'')||!/^acct_[A-Za-z0-9_]+$/.test(event.account||''))return;
  const options={stripeAccount:event.account,timeout:5000,maxNetworkRetries:0};
  const refund=await stripe.refunds.retrieve(refundId,{},options);
  const sessionId=refund.metadata?.checkout_session_id;
  if(refund.id!==refundId || refund.metadata?.parkshare_reason!=='invalid_registered_checkout'
      || !/^cs_[A-Za-z0-9_]+$/.test(sessionId||''))return;
  const {data:pending,error}=await db.from('pending_booking_extensions')
    .select('booking_id,renter_id,added_hours,expected_connected_account_id,stripe_checkout_session_id,hold_id')
    .eq('stripe_checkout_session_id',sessionId).maybeSingle();
  if(error)throw error;
  if(!pending||pending.expected_connected_account_id!==event.account)return;
  const {data:existing,error:existingError}=await db.from('booking_extensions').select('id,application_state')
    .eq('stripe_checkout_session_id',sessionId).maybeSingle();
  if(existingError)throw existingError;
  if(existing?.application_state==='applied')return;
  const session=await stripe.checkout.sessions.retrieve(sessionId,{},options);
  if(session.id!==sessionId||session.livemode!==event.livemode)throw new Error('refund_checkout_identity_mismatch');
  const payment=await readExtensionPayment({session,account:event.account,pending,stripe});
  if(stripeObjectId(refund.payment_intent)!==payment.pi||stripeObjectId(refund.charge)!==payment.chargeId
      || !payment.history.some(r=>r.id===refund.id))throw new Error('refund_extension_identity_mismatch');
  await recordRejectedExtension({event:{...event,data:{object:session}},db,payment});
}
