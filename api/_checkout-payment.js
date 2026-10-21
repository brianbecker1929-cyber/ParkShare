// Inspect current, account-scoped captured money before settling a registered Checkout.
import {stripeObjectId} from "./_refund-rules.js";
import {refundLedgerSnapshot} from "./_refund-ledger.js";
export async function readRegisteredCheckoutPayment({session, account, registration, stripe}) {
  if (!/^acct_[A-Za-z0-9_]+$/.test(account || '') || account !== registration.expected_connected_account_id
      || !/^cs_[A-Za-z0-9_]+$/.test(session.id || '') || session.payment_status !== 'paid'
      || typeof session.livemode !== 'boolean' || session.currency !== 'cad') throw new Error('checkout_payment_identity_mismatch');
  const deadline=Date.now()+20000;
  const options=()=>{const remaining=deadline-Date.now();if(remaining<=0)throw new Error('checkout_payment_read_timeout');
    return {stripeAccount:account,timeout:Math.min(5000,remaining),maxNetworkRetries:0};};
  const pi = stripeObjectId(session.payment_intent);
  if (!/^pi_[A-Za-z0-9_]+$/.test(pi || '')) throw new Error('checkout_intent_missing');
  const intent = await stripe.paymentIntents.retrieve(pi, {}, options());
  const chargeId = stripeObjectId(intent.latest_charge);
  if (intent.id !== pi || intent.livemode !== session.livemode || intent.status !== 'succeeded'
      || intent.currency !== 'cad' || intent.amount_received !== session.amount_total
      || !/^ch_[A-Za-z0-9_]+$/.test(chargeId || '')) throw new Error('checkout_intent_identity_mismatch');
  const history=[]; let cursor, complete=false;
  for(let n=0;n<100;n++) {
    const page=await stripe.refunds.list({charge:chargeId,limit:100,...(cursor?{starting_after:cursor}:{})},options());
    if(!Array.isArray(page.data)||typeof page.has_more!=='boolean') throw new Error('incomplete_refund_history');
    history.push(...page.data);
    if(!page.has_more){complete=true;break;}
    const next=page.data.at(-1)?.id;
    if(!/^re_[A-Za-z0-9_]+$/.test(next||'')||next===cursor) throw new Error('incomplete_refund_history');
    cursor=next;
  }
  if(!complete) throw new Error('refund_history_requires_review');
  const charge=await stripe.charges.retrieve(chargeId,{},options());
  const gross=session.amount_total;
  if(!Number.isSafeInteger(gross)||gross<=0) throw new Error('checkout_gross_invalid');
  const snapshot=refundLedgerSnapshot(charge,history,{paymentIntentId:pi,chargeId,livemode:session.livemode,gross});
  return {pi,chargeId,gross,charge,history,snapshot,hasReversal:snapshot.settled>0||snapshot.pending>0||charge.refunded===true||charge.disputed===true};
}
