// One authenticated entry point for cancellation, partial refund and staff review.
import {decideRefund, originalProcessingFee, refundRequestIntent} from './_refund-policy.js';
import {isParkShareStaff} from '../src/lib/cancellationReasons.js';
import {processBookingRefund} from './_refund-operations.js';

export function createRefundHandler({db, payments, authenticate, live = false}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'Method not allowed'}); }
    try {
      const user = await authenticate(req, res);
      if (!user) return;
      const body = req.body || {}, bookingId = Number(body.bookingId);
      if (body.action === 'reviews') {
        if (!isParkShareStaff(user)) return res.status(403).json({error:'Staff access is required.'});
        const reviews = await db.from('booking_cancellation_reviews').select('id,booking_id,explanation,created_at').order('created_at',{ascending:false}).limit(50);
        if (reviews.error) throw reviews.error;
        return res.status(200).json({reviews:reviews.data});
      }
      if (!Number.isSafeInteger(bookingId) || bookingId <= 0) return res.status(400).json({error: 'Invalid booking.'});
      const {data: booking, error} = await db.from('bookings').select('id,listing_id,renter_id,hours,total,status,paid_at,booking_date,start_hour,scheduled_starts_at,property_time_zone,stripe_payment_intent_id,stripe_charge_id,stripe_connected_account_id,cancellation_requested_at,cancelled_at,cancelled_by,stripe_refund_id,refund_status,refund_total_amount,refund_pending_amount,refund_ledger_revision').eq('id', bookingId).single();
      if (error || !booking) return res.status(404).json({error: 'Booking not found.'});
      const {data: listing, error: listingError} = await db.from('listings').select('host_id').eq('id', booking.listing_id).single();
      if (listingError || !listing) return res.status(404).json({error: 'Listing not found.'});
      const staff = isParkShareStaff(user), owner = user.id === listing.host_id || user.id === booking.renter_id;
      if (!staff && !owner) return res.status(403).json({error: 'You cannot access this booking.',code:'forbidden'});
      if (body.action === 'lookup') {
        if (!staff && user.id !== listing.host_id) return res.status(403).json({error: 'Refund review requires Host or staff access.'});
        const jobs = await db.from('booking_refund_operations').select('id,action,reason_code,fee_payer,amount_cents,processing_fee_cents,fee_credit_cents,refund_status,transfer_id,state,review_code,created_at').eq('booking_id', bookingId).order('created_at', {ascending: false}).limit(20);
        if (jobs.error) throw jobs.error;
        return res.status(200).json({booking: {id: booking.id,status: booking.status,total: booking.total,refunded: booking.refund_total_amount || 0}, operations: jobs.data, staff});
      }
      const intent = refundRequestIntent({user, booking, hostId: listing.host_id, body});
      if (intent.error) return res.status(intent.status).json({error:intent.error,code:intent.code});
      const findExistingPartial = async () => {
        if (intent.action !== 'refund') return null;
        const saved = await db.from('booking_refund_operations')
          .select('id,booking_id,request_key,requested_by,actor,action,reason_code,explanation,fee_payer,connected_account_id,payment_intent_id,charge_id,livemode,currency,gross_cents,amount_cents,refund_status,state')
          .eq('booking_id', booking.id).eq('request_key', intent.requestKey).maybeSingle();
        if (saved.error) throw saved.error;
        return saved.data;
      };
      const matchesPartial = op => Number(op.booking_id) === Number(booking.id) && op.request_key === intent.requestKey
        && op.requested_by === user.id && op.actor === intent.actor && op.action === intent.action
        && op.reason_code === intent.reason.code && op.explanation === intent.explanation && op.fee_payer === intent.reason.payer
        && Number(op.amount_cents) === body.amountCents && Number(op.gross_cents) === Math.round(Number(booking.total) * 100)
        && op.connected_account_id === booking.stripe_connected_account_id && op.payment_intent_id === booking.stripe_payment_intent_id
        && op.charge_id === booking.stripe_charge_id && op.livemode === live && op.currency === 'cad';
      const conflict = () => res.status(409).json({code:'request_conflict',error:'This request reference is already associated with different refund details. Review the booking before preparing another refund.'});
      const acknowledgePartial = op => {
        if (!matchesPartial(op)) return conflict();
        const review = op.state === 'review' || ['failed','canceled'].includes(op.refund_status);
        const complete = !review && op.state === 'complete' && op.refund_status === 'succeeded';
        const message = review ? 'This existing refund request needs ParkShare staff review. Please contact support with your booking number.'
          : complete ? 'This partial refund has already been processed.'
          : op.refund_status === 'succeeded' ? 'Stripe has already confirmed this partial refund. Reconciliation or any Host fee reimbursement is still pending.'
          : 'This partial refund request has already been submitted and is still processing. Please refresh shortly.';
        return res.status(complete ? 200 : 202).json({bookingId:booking.id,bookingStatus:booking.status,operationId:op.id,
          amountCents:Number(op.amount_cents),refundStatus:op.refund_status || null,operationState:op.state,feePayer:op.fee_payer,
          alreadyProcessed:complete,alreadySubmitted:true,reviewRequired:review,message});
      };
      // A settled refund has already reduced both balances. A matching retry is
      // a read of its durable operation, never a new request to the worker/Stripe.
      const existingPartial = await findExistingPartial();
      if (existingPartial) return acknowledgePartial(existingPartial);
      const decision = decideRefund({user, booking, hostId: listing.host_id, body});
      if (decision.error) return res.status(decision.status).json({error: decision.error,code:decision.code});
      if (decision.review) {
        if (!booking.paid_at || !['confirmed','completed'].includes(booking.status)) return res.status(409).json({error:'Only a paid booking can be reviewed.'});
        const saved = await db.from('booking_cancellation_reviews').upsert({booking_id: booking.id,requested_by: user.id,reason_code: decision.reason.code,explanation: decision.explanation}, {onConflict: 'booking_id,requested_by',ignoreDuplicates: true});
        if (saved.error) throw saved.error;
        return res.status(202).json({bookingId: booking.id,bookingStatus: booking.status,reviewRequired: true,message: 'Your access problem has been recorded for ParkShare support review. No refund has been issued and your booking remains active. Please contact support with your booking number.'});
      }
      if (decision.existing) return res.status(200).json({bookingId: booking.id,bookingStatus: booking.status,refundStatus: booking.refund_status,alreadyProcessed: true,message:'This cancellation has already been submitted.'});
      if (decision.action === 'cancel') {
        const extensions = await db.from('booking_extensions').select('id').eq('booking_id', booking.id).or('application_state.eq.applied,charge_fully_refunded.is.null,charge_fully_refunded.eq.false').limit(1);
        if (extensions.error) throw extensions.error;
        if (extensions.data?.length) return res.status(409).json({error:'This booking has paid extensions. ParkShare support must review all associated charges together.'});
      }
      if (!booking.stripe_charge_id || !booking.stripe_connected_account_id || !booking.stripe_payment_intent_id) return res.status(409).json({error:'This payment needs ParkShare support review.'});
      const charge = await payments.charges.retrieve(booking.stripe_charge_id, {expand:['balance_transaction']}, {stripeAccount: booking.stripe_connected_account_id,timeout:8000,maxNetworkRetries:0});
      const fee = originalProcessingFee(charge, booking, live);
      if (decision.amount > charge.amount - charge.amount_refunded) {
        // Another copy of this request may have completed after the first lookup.
        const existing = await findExistingPartial();
        if (existing) return acknowledgePartial(existing);
        return res.status(409).json({error:'The payment has changed. Refresh the booking before requesting a refund.'});
      }
      const reserved = await db.rpc('reserve_booking_refund', {p_operation: {
        booking_id:booking.id,request_key:decision.requestKey,requested_by:user.id,actor:decision.actor,action:decision.action,
        reason_code:decision.reason.code,explanation:decision.explanation,fee_payer:decision.reason.payer,
        connected_account_id:booking.stripe_connected_account_id,payment_intent_id:booking.stripe_payment_intent_id,
        charge_id:booking.stripe_charge_id,livemode:live,gross_cents:decision.gross,amount_cents:decision.amount,processing_fee_cents:fee,
      }});
      if (reserved.error) {
        const existing = await findExistingPartial();
        if (existing) return acknowledgePartial(existing);
        return res.status(409).json({error:'Another refund is pending or requires review. Refresh this booking or contact ParkShare support.'});
      }
      const op = reserved.data;
      if (intent.action === 'refund') {
        // The reservation RPC can return an existing row after a concurrent
        // insert. Recheck the immutable intent before touching the worker.
        if (!matchesPartial(op)) return conflict();
        if (op.state !== 'queued' || op.refund_status) return acknowledgePartial(op);
      }
      const outcome = await processBookingRefund({db,stripe:payments,id:op.id,livemode:live});
      if (outcome === 'review') return res.status(202).json({bookingId:booking.id,bookingStatus:booking.status,operationId:op.id,reviewRequired:true,message:'This refund request needs ParkShare staff review. Please contact support with your booking number.'});
      return res.status(202).json({bookingId:booking.id,bookingStatus:booking.status,operationId:op.id,feePayer:op.fee_payer,message:'Refund request recorded. Booking status and any Host fee reimbursement update after Stripe confirms processing. Please refresh shortly.'});
    } catch (error) {
      console.error('cancel-booking: request failed', error?.code || 'payment_or_database_unavailable');
      return res.status(503).json({error:'Unable to process this request right now. Retry the same request or contact ParkShare support.'});
    }
  };
}
