import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  paymentReconciliationTarget,
  applyAccountScopedBookingReconciliation,
} from "../api/_refund-dispute-account-safety.js";

const logged = { warn() {} };
const stripeEvent = { account: "acct_valid_123", livemode: false };

test("connected-account refund/dispute target requires signed event account, mode and typed identifier", () => {
  assert.deepEqual(paymentReconciliationTarget(stripeEvent, "paymentIntent", "pi_42"), {
    key: "stripe_payment_intent_id", identifier: "pi_42", connectedAccountId: "acct_valid_123",
  });
  assert.deepEqual(paymentReconciliationTarget(stripeEvent, "charge", "ch_42"), {
    key: "stripe_charge_id", identifier: "ch_42", connectedAccountId: "acct_valid_123",
  });
  for (const [event,kind,id] of [
    [{ livemode:false },"paymentIntent","pi_42"],
    [{account:"acct_valid_123"},"paymentIntent","pi_42"],
    [{account:"evil",livemode:false},"paymentIntent","pi_42"],
    [stripeEvent,"paymentIntent","ch_42"],
    [stripeEvent,"charge","pi_42"],
    [stripeEvent,"charge","ch_"],
    [stripeEvent,"other","pi_42"],
  ]) assert.equal(paymentReconciliationTarget(event,kind,id),null);
});

function stubBuilder({data=[{id:9}],error=null}={}) {
  const applied = { column:null, filters:[], guardedStatuses:null };
  const chain = {
    update(value) { applied.update=value; return this; },
    eq(key,value) { applied.filters.push(["eq",key,value]); return this; },
    is(key,value) { applied.filters.push(["is",key,value]); return this; },
    not(column,operation,value) { applied.guardedStatuses=[column,operation,value]; return this; },
    async select(column) { applied.column=column; return {data,error}; },
  };
  return { db:{from(table){ applied.table=table;return chain;}},applied };
}

test("refund update always matches both payment ID and stored Host account, returns updated rows", async () => {
  const {db,applied}=stubBuilder();
  const target=paymentReconciliationTarget(stripeEvent,"paymentIntent","pi_42");
  const result=await applyAccountScopedBookingReconciliation(db,target,{status:"refunded"},{label:"refund",logger:logged});
  assert.deepEqual(result,{applied:true,reason:"updated"});
  assert.deepEqual(applied, {
    table:"bookings", update:{status:"refunded"},
    filters:[["eq","stripe_payment_intent_id","pi_42"],["eq","stripe_connected_account_id","acct_valid_123"]],
    guardedStatuses:null, column:"id",
  });
});

test("dispute update also requires exact charge and connected account, no refund workflow called", async () => {
  const {db,applied}=stubBuilder();
  const target=paymentReconciliationTarget(stripeEvent,"charge","ch_90");
  await applyAccountScopedBookingReconciliation(db,target,{status:"disputed"},{excludeStatuses:["refunded"],logger:logged});
  assert.deepEqual(applied.filters,[
    ["eq","stripe_charge_id","ch_90"],["eq","stripe_connected_account_id","acct_valid_123"],
  ]);
  assert.deepEqual(applied.guardedStatuses,["status","in","(refunded)"]);
});

test("stale partial refund cannot downgrade a refunded/disputed booking",async()=>{
  const {db,applied}=stubBuilder({data:[]});
  const target=paymentReconciliationTarget(stripeEvent,"paymentIntent","pi_42");
  const result=await applyAccountScopedBookingReconciliation(db,target,{status:"partially_refunded"},{
    excludeStatuses:["refunded","disputed"],logger:logged,
  });
  assert.equal(result.applied,false);
  assert.deepEqual(applied.guardedStatuses,["status","in","(refunded,disputed)"]);
});

test("refund lifecycle CAS never overwrites a different concurrently recorded refund ID",async()=>{
  const {db,applied}=stubBuilder();
  const target=paymentReconciliationTarget(stripeEvent,"paymentIntent","pi_42");
  await applyAccountScopedBookingReconciliation(db,target,{refund_status:"succeeded"},{
    expectedRefundId:null,logger:logged,
  });
  assert.ok(applied.filters.some(x=>x[0]==="is"&&x[1]==="stripe_refund_id"&&x[2]===null));
  const another=stubBuilder();
  await applyAccountScopedBookingReconciliation(another.db,target,{refund_status:"failed"},{
    expectedRefundId:"re_existing",logger:logged,
  });
  assert.ok(another.applied.filters.some(x=>x[0]==="eq"&&x[1]==="stripe_refund_id"&&x[2]==="re_existing"));
});

test("Supabase write error throws and is never acknowledged as successful",async()=>{
  const error={code:"42501",message:"permission denied"};
  const {db}=stubBuilder({data:null,error});
  const target=paymentReconciliationTarget(stripeEvent,"charge","ch_42");
  await assert.rejects(
    applyAccountScopedBookingReconciliation(db,target,{status:"disputed"},{logger:logged}),
    err=>err===error
  );
});

test("no matching owner row is NOT reported as successful update",async()=>{
  const {db}=stubBuilder({data:[]});
  const target=paymentReconciliationTarget(stripeEvent,"charge","ch_42");
  assert.deepEqual(await applyAccountScopedBookingReconciliation(db,target,{status:"disputed"},{logger:logged}),
    {applied:false,reason:"no_matching_booking"});
});

test("webhook delegates refund families to the atomic current-history reconciler; disputes remain account scoped",async()=>{
  const s=await readFile(new URL("../api/stripe-webhook.js",import.meta.url),"utf8");
  const section=s.slice(s.indexOf('case "charge.refunded":'),s.indexOf("default:",s.indexOf('case "charge.refunded":')));
  assert.match(section,/reconcilePaymentRefund\(\{ event, stripe, db: supabaseAdmin \}\)/);
  assert.match(section,/paymentReconciliationTarget\(event, "charge", reconciliation\?\.chargeId\)/);
  assert.equal((section.match(/applyAccountScopedBookingReconciliation\(supabaseAdmin, target/g)||[]).length,1);
  assert.doesNotMatch(section,/refundRecordPolicy|refund_amount:|Multiple refunds require/);
});
