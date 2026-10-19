// Persist verified current Stripe refund history. No charge/refund creation,
// entitlement changes for extensions, notifications, or public ledger access.
import {moneyCents, settledRefundTotals} from './_host-earnings.js';
import {stripeObjectId} from './_refund-rules.js';
import {retryTransientSupabaseRead} from './_webhook-db-retry.js';

const valid=(kind,id)=>new RegExp(`^${kind}_[A-Za-z0-9_]+$`).test(id||'');
export function refundLedgerSnapshot(charge, refunds, {paymentIntentId,chargeId,livemode,gross,requiredRefundId=null}) {
  if(charge.id!==chargeId || stripeObjectId(charge.payment_intent)!==paymentIntentId || charge.livemode!==livemode
    || charge.currency!=='cad' || charge.amount!==gross || charge.amount_captured!==gross
    || charge.paid!==true || charge.captured!==true || charge.status!=='succeeded')throw new Error('refund_charge_identity_mismatch');
  const unique=new Map();
  for(const r of refunds) {
    if(!Number.isSafeInteger(r.created)||r.created<=0 || !Number.isSafeInteger(r.amount)||r.amount<=0)throw new Error('invalid_refund_record');
    const row={refund_id:r.id,amount_cents:r.amount,status:r.status,created:r.created,
      failure_reason:typeof r.failure_reason==='string'?r.failure_reason.slice(0,200):null};
    if(unique.has(r.id)&&JSON.stringify(unique.get(r.id))!==JSON.stringify(row))throw new Error('refund_changed_during_read');
    unique.set(r.id,row);
  }
  const {settled,pending}=settledRefundTotals(refunds,charge);
  if(requiredRefundId&&!unique.has(requiredRefundId))throw new Error('delivered_refund_missing_from_history');
  // Stripe's Charge can count in-flight refunds. Only succeeded Refunds
  // count toward settled money; pending amounts remain separate.
  return {refunds:[...unique.values()].sort((a,b)=>a.created-b.created||a.refund_id.localeCompare(b.refund_id)),settled,pending};
}

export async function reconcilePaymentRefund({event,stripe,db,read=retryTransientSupabaseRead,logger=console}) {
  const account=event?.account,object=event?.data?.object;
  if(!valid('acct',account)||!valid('evt',event?.id)||typeof event?.livemode!=='boolean')return {applied:false,reason:'invalid_event'};
  const isCharge=event.type==='charge.refunded';
  const refundId=isCharge?null:stripeObjectId(object);
  if(!isCharge&&!valid('re',refundId))return {applied:false,reason:'invalid_refund'};
  let currentRefund=null;
  let pi=stripeObjectId(object?.payment_intent),chargeId=isCharge?stripeObjectId(object):stripeObjectId(object?.charge);
  const deadline=Date.now()+20000;
  const options=()=>{const remaining=deadline-Date.now();if(remaining<=0)throw new Error('refund_reconciliation_timeout');
    return {stripeAccount:account,timeout:Math.min(5000,remaining),maxNetworkRetries:0};};
  if(!isCharge){
    const current=await stripe.refunds.retrieve(refundId,{},options());
    currentRefund=current;
    if(current.id!==refundId)throw new Error('refund_identity_mismatch');
    const currentPi=stripeObjectId(current.payment_intent),currentCharge=stripeObjectId(current.charge);
    if(pi&&pi!==currentPi||chargeId&&chargeId!==currentCharge)throw new Error('refund_event_identity_mismatch');
    pi=currentPi;chargeId=currentCharge;
  }
  if(!valid('pi',pi)||!valid('ch',chargeId))throw new Error('refund_payment_identity_missing');
  const lookup=async(table,amount)=>{
    const {data,error}=await read(()=>db.from(table)
      .select(`id,${amount},paid_at,stripe_charge_id,refund_ledger_revision`)
      .eq('stripe_payment_intent_id',pi).eq('stripe_connected_account_id',account).maybeSingle());
    if(error)throw error;return data;
  };
  const [booking,extension]=await Promise.all([lookup('bookings','total'),lookup('booking_extensions','added_amount')]);
  if(booking&&extension)throw new Error('ambiguous_refund_owner');
  const owner=booking||extension;
  if(!owner){logger.warn('[refund-ledger] no owner-matched payment',{eventId:event.id});return {applied:false,reason:'unmatched'};}
  if(!owner.paid_at)throw new Error('refund_owner_unpaid');
  if(owner.stripe_charge_id&&owner.stripe_charge_id!==chargeId)throw new Error('refund_owner_charge_mismatch');
  // The version is read BEFORE current charge/history retrieval. The SQL
  // transaction compares it under a row lock, so concurrent deliveries or
  // cancellation/dispute writes cannot commit an older financial snapshot.
  const revision=Number(owner.refund_ledger_revision);
  if(!Number.isSafeInteger(revision)||revision<0)throw new Error('refund_schema_or_revision_unavailable');
  if(!owner.stripe_charge_id){
    const intent=await stripe.paymentIntents.retrieve(pi,{},options());
    if(intent.id!==pi||intent.livemode!==event.livemode||stripeObjectId(intent.latest_charge)!==chargeId)throw new Error('refund_intent_charge_mismatch');
  }
  const history=[];let cursor,complete=false;
  for(let n=0;n<100;n++){
    const page=await stripe.refunds.list({charge:chargeId,limit:100,...(cursor?{starting_after:cursor}:{})},options());
    if(!Array.isArray(page.data)||typeof page.has_more!=='boolean')throw new Error('incomplete_refund_history');
    history.push(...page.data);
    if(!page.has_more){complete=true;break;}
    const next=page.data.at(-1)?.id;
    if(!valid('re',next)||next===cursor)throw new Error('incomplete_refund_history');
    cursor=next;
  }
  if(!complete)throw new Error('refund_history_requires_review');
  if(currentRefund){
    const listed=history.find(r=>r.id===refundId);
    if(!listed || listed.status!==currentRefund.status || listed.amount!==currentRefund.amount || listed.created!==currentRefund.created)
      throw new Error('refund_changed_during_read');
  }
  const charge=await stripe.charges.retrieve(chargeId,{},options());
  const gross=moneyCents(booking?owner.total:owner.added_amount);
  const snapshot=refundLedgerSnapshot(charge,history,{paymentIntentId:pi,chargeId,livemode:event.livemode,gross,requiredRefundId:refundId});
  if(!snapshot.refunds.length)throw new Error('empty_refund_history');
  const {data,error}=await db.rpc('reconcile_payment_refunds',{
    p_kind:booking?'booking':'extension',p_record_id:owner.id,p_account:account,p_payment_intent:pi,p_charge:chargeId,
    p_livemode:event.livemode,p_expected_revision:revision,p_event_id:event.id,
    p_gross_cents:gross,p_charge_refunded_cents:charge.amount_refunded,p_refunds:snapshot.refunds,p_disputed:charge.disputed===true,
  });
  if(error)throw error;
  if(data?.applied!==true)throw new Error('refund_ledger_not_applied');
  return data;
}
