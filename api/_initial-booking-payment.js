import {readRegisteredCheckoutPayment} from './_checkout-payment.js';

export async function finishRejectedInitialBooking({event,booking,stripe,db,reconcile,payment}) {
  const session=event.data.object;
  if(event.livemode!==session.livemode)throw new Error('checkout_event_mode_mismatch');
  if(booking.application_state!=='rejected')throw new Error('booking_not_rejected');
  const money=payment||await readRegisteredCheckoutPayment({session,account:event.account,
    registration:{expected_connected_account_id:booking.stripe_connected_account_id},stripe});
  if(money.pi!==booking.stripe_payment_intent_id||money.chargeId!==booking.stripe_charge_id
    || money.gross!==Math.round(Number(booking.total)*100)||session.id!==booking.stripe_checkout_session_id)
    throw new Error('rejected_booking_payment_identity_mismatch');
  if(booking.checkout_rejection_reason==='booking_conflict'&&!money.hasReversal) {
    await stripe.refunds.create({payment_intent:money.pi,reason:'requested_by_customer',refund_application_fee:true,
      metadata:{parkshare_reason:'booking_conflict',checkout_session_id:session.id}},
      {stripeAccount:event.account,idempotencyKey:`booking-conflict-${session.id}`});
  }
  if(money.charge.disputed!==true||money.history.length)await reconcile({event,stripe,db});
}

export async function settleInitialBooking({event,hold,row,stripe,db,reconcile}) {
  if(event.livemode!==event.data.object.livemode)throw new Error('checkout_event_mode_mismatch');
  const money=await readRegisteredCheckoutPayment({session:event.data.object,account:event.account,registration:hold,stripe});
  if(money.pi!==row.stripe_payment_intent_id||money.chargeId!==row.stripe_charge_id||money.gross!==Math.round(row.total*100))
    throw new Error('booking_payment_changed_during_validation');
  const {data,error}=await db.rpc('settle_initial_booking_checkout',{
    p_hold_id:hold.id,p_booking:row,p_payment_reversed:money.hasReversal,
  });
  if(error)throw error;
  if(!data?.booking?.id||typeof data.applied!=='boolean'||typeof data.refund_required!=='boolean'
    || data.booking.stripe_checkout_session_id!==event.data.object.id
    || data.refund_required!==(data.booking.application_state==='rejected')
    || data.applied&&data.refund_required)throw new Error('booking_settlement_result_invalid');
  if(data.refund_required)await finishRejectedInitialBooking({event,booking:data.booking,stripe,db,reconcile,payment:money});
  return data;
}
