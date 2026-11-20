// Read model only. Never creates refunds, updates bookings or infers fee policy.
import {stripeObjectId} from './_refund-rules.js';

export function moneyCents(value) {
  if (!['number','string'].includes(typeof value) || String(value).trim()==='') throw new Error('missing_amount');
  const n=Number(value), cents=Math.round(n*100);
  if (!Number.isFinite(n) || !Number.isSafeInteger(cents) || n<0 || Math.abs(n*100-cents)>1e-6) throw new Error('invalid_amount');
  return cents;
}
const cents=value=>{
  if (!Number.isSafeInteger(value) || value<0) throw new Error('invalid_stripe_amount');
  return value;
};

export function settledRefundTotals(refunds,charge) {
  const seen=new Map();let settled=0,pending=0;
  for(const refund of refunds) {
    if (!/^re_[A-Za-z0-9_]+$/.test(refund.id||'') || stripeObjectId(refund.charge)!==charge.id
      || stripeObjectId(refund.payment_intent)!==stripeObjectId(charge.payment_intent)
      || refund.currency!==charge.currency) throw new Error('refund_identity_mismatch');
    const amount=cents(refund.amount);
    if (!['succeeded','pending','requires_action','failed','canceled'].includes(refund.status)) throw new Error('unknown_refund_state');
    const signature=amount+':'+refund.status;
    if (seen.has(refund.id)) {
      if (seen.get(refund.id)!==signature) throw new Error('refund_changed_during_read');
      continue;
    }
    seen.set(refund.id,signature);
    if(refund.status==='succeeded')settled+=amount;
    if(['pending','requires_action'].includes(refund.status))pending+=amount;
  }
  if(!Number.isSafeInteger(settled+pending) || settled+pending>charge.amount) throw new Error('refund_exceeds_charge');
  const reported=cents(charge.amount_refunded);
  if(reported<settled || reported>settled+pending)throw new Error('refund_snapshot_inconsistent');
  return {settled,pending};
}

export function remainingHostAmounts({gross,fee,refunded,feeRefunded}) {
  for(const amount of [gross,fee,refunded,feeRefunded])cents(amount);
  if(fee>gross || refunded>gross || feeRefunded>fee)throw new Error('inconsistent_fee_or_refund');
  // Proceeds before Stripe processing fees. A retained application fee can
  // leave a negative contribution after a full customer refund; do not clamp.
  const retainedFee=fee-feeRefunded;
  return {gross:gross/100,platformFee:retainedFee/100,originalPlatformFee:fee/100,
    refundedAmount:refunded/100,platformFeeRefunded:feeRefunded/100,
    originalNet:(gross-fee)/100,net:(gross-refunded-retainedFee)/100};
}

async function readAllRefunds(stripe,charge,requestOptions) {
  const refunds=[];let cursor;
  for(let pageNumber=0;pageNumber<100;pageNumber++) {
    const page=await stripe.refunds.list({charge:charge.id,limit:100,...(cursor?{starting_after:cursor}:{})},requestOptions());
    if(!Array.isArray(page.data) || typeof page.has_more!=='boolean')throw new Error('incomplete_refund_page');
    refunds.push(...page.data);
    if(!page.has_more)return refunds;
    const next=page.data.at(-1)?.id;
    if(!next || next===cursor)throw new Error('incomplete_refund_history');
    cursor=next;
  }
  throw new Error('refund_history_requires_review');
}

function originalAmounts(row,isExtension) {
  const gross=moneyCents(isExtension?row.added_amount:row.total);
  // Extensions do not persist a fee split. Resolve their actual fee from
  // Stripe below instead of backing an estimated 15% out of the total.
  const fee=isExtension?0:moneyCents(row.service_fee);
  if(fee>gross || (!isExtension && moneyCents(row.subtotal)!==gross-fee))throw new Error('stored_split_mismatch');
  return {gross,fee};
}

export async function hostEarningsForRecord(stripe,row,{isExtension=false,logger=console,deadlineAt=Infinity}={}) {
  try {
    let {gross,fee}=originalAmounts(row,isExtension);
    if(row.status==='disputed' || row.charge_disputed===true)throw new Error('dispute_requires_review');
    const hasRefundEvidence=['partially_refunded','refunded','cancelled','canceled'].includes(row.status)
      || row.stripe_refund_id || row.refund_status || row.refund_amount!=null
      || row.charge_amount_refunded!=null || row.charge_fully_refunded===true;
    if(!hasRefundEvidence && !['confirmed','completed'].includes(row.status))throw new Error('unverified_payment_state');
    if(!hasRefundEvidence && !isExtension) return {
      ...remainingHostAmounts({gross,fee,refunded:0,feeRefunded:0}),
      earningsStatus:row.status,earningsState:'verified',approximateFeeSplit:false,
      refundPendingAmount:0,
    };
    const account=row.stripe_connected_account_id,pi=row.stripe_payment_intent_id;
    if(!/^acct_[A-Za-z0-9_]+$/.test(account||'') || !/^pi_[A-Za-z0-9_]+$/.test(pi||''))throw new Error('missing_payment_identity');
    const options=(connected=true)=>{
      const remaining=deadlineAt-Date.now();
      if(remaining<=0)throw new Error('reconciliation_time_budget');
      return {...(connected?{stripeAccount:account}:{}),timeout:Math.min(5000,remaining),maxNetworkRetries:0};
    };
    let chargeId=row.stripe_charge_id;
    if(!chargeId) {
      const intent=await stripe.paymentIntents.retrieve(pi,{},options());
      if(intent.id!==pi)throw new Error('payment_identity_mismatch');
      chargeId=stripeObjectId(intent.latest_charge);
    }
    if(!/^ch_[A-Za-z0-9_]+$/.test(chargeId||''))throw new Error('missing_charge');
    const charge=await stripe.charges.retrieve(chargeId,{},options());
    if(charge.id!==chargeId || stripeObjectId(charge.payment_intent)!==pi || charge.currency!=='cad'
      || charge.amount!==gross || charge.amount_captured!==gross || charge.paid!==true
      || charge.captured!==true || charge.status!=='succeeded' || typeof charge.livemode!=='boolean'
      || charge.disputed===true)throw new Error('charge_requires_review');
    const refunds=await readAllRefunds(stripe,charge,options);
    const {settled,pending}=settledRefundTotals(refunds,charge);
    let feeRefunded=0;
    const feeId=stripeObjectId(charge.application_fee);
    if(feeId) {
      if(!/^fee_[A-Za-z0-9_]+$/.test(feeId))throw new Error('invalid_application_fee');
      // Application fees belong to the platform; charge/refund reads above
      // belong to the original connected account. Verify the relationship.
      const applicationFee=await stripe.applicationFees.retrieve(feeId,{},options(false));
      if(applicationFee.id!==feeId || stripeObjectId(applicationFee.account)!==account
        || stripeObjectId(applicationFee.charge)!==charge.id || applicationFee.currency!==charge.currency
        || applicationFee.livemode!==charge.livemode)throw new Error('fee_identity_mismatch');
      const actualFee=cents(applicationFee.amount);
      if((!isExtension && actualFee!==fee) || actualFee!==charge.application_fee_amount)throw new Error('fee_amount_mismatch');
      fee=actualFee;feeRefunded=cents(applicationFee.amount_refunded);
    } else if(fee!==0 || (charge.application_fee_amount??0)!==0) throw new Error('application_fee_unavailable');
    return {
      ...remainingHostAmounts({gross,fee,refunded:settled,feeRefunded}),
      earningsStatus:settled===gross?'refunded':pending>0?'refund_pending':settled>0?'partially_refunded':row.status==='completed'?'completed':'confirmed',
      earningsState:'verified',approximateFeeSplit:false,refundPendingAmount:pending/100,
    };
  } catch(error) {
    logger.warn('[host-earnings] transaction needs review',{code:error?.code||'reconciliation_unavailable'});
    return {net:null,earningsState:'needs_review',earningsStatus:row.status==='disputed'||row.charge_disputed?'disputed':'review',
      refundedAmount:null,platformFee:null,refundPendingAmount:null,approximateFeeSplit:false};
  }
}

export async function mapHostEarnings(records,resolve,concurrency=4) {
  const results=new Array(records.length);let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,records.length)},async()=>{
    for(;;){const index=next++;if(index>=records.length)return;results[index]=await resolve(records[index]);}
  }));
  return results;
}
