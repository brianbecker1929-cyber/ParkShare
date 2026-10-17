import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { reconcilePaidCheckout } from "../src/lib/stripeReconciliation.js";

const account = "acct_Sandbox123";
const renter = "00000000-0000-4000-8000-000000000123";
const listingIds = new Set([12]);
const profileIds = new Set([renter]);
const session = {
  id: "cs_test_valid",
  livemode: false,
  payment_status: "paid",
  amount_total: 2760,
  payment_intent: "pi_test_valid",
  metadata: {
    listing_id: "12",
    renter_id: renter,
    connected_account_id: account,
    total_cents: "2760",
  },
};
const booking = {
  stripe_checkout_session_id: "cs_test_valid",
  stripe_connected_account_id: account,
  stripe_payment_intent_id: "pi_test_valid",
  listing_id: 12,
  renter_id: renter,
  total: 27.60,
  status: "confirmed",
};
function audit(custom = {}) {
  return reconcilePaidCheckout({
    session, eventAccount: account, eventLivemode: false,
    booking, listingIds, profileIds, expectedLivemode: false,
    ...custom,
  });
}
test("matching paid Checkout Session and persisted booking reconcile", () => {
  assert.deepEqual(audit(), { status: "booking_recorded", severity: "ok" });
});
test("paid but missing booking is a critical finding, never silently ignored", () => {
  assert.equal(audit({booking:null}).status, "paid_without_booking");
  const missing = audit({booking:null,listingIds:new Set(),profileIds:new Set()});
  assert.equal(missing.status, "paid_without_booking_missing_references");
  assert.equal(missing.missingListing, true);
  assert.equal(missing.missingRenter, true);
  assert.equal(missing.severity, "critical");
});
test("cross-mode and connected-account mismatches fail closed", () => {
  assert.equal(audit({eventLivemode:true}).status, "stripe_mode_mismatch");
  assert.equal(audit({eventAccount:"acct_Other"}).status, "connected_account_mismatch");
  assert.equal(audit({eventAccount:null}).status, "missing_connect_account");
});
test("unpaid or delayed Checkout Session is not classified as a paid missing booking", () => {
  assert.equal(audit({session:{...session,payment_status:"unpaid"},booking:null}).status, "not_paid");
});
test("amount and reference inconsistencies are critical", () => {
  assert.equal(audit({session:{...session,amount_total:2800}}).status, "checkout_metadata_amount_mismatch");
  assert.equal(audit({session:{...session,amount_total:null}}).status, "missing_stripe_amount");
  assert.equal(audit({booking:{...booking,total:27.61}}).status, "booking_record_mismatch");
  assert.equal(audit({booking:{...booking,stripe_payment_intent_id:"pi_other"}}).status, "booking_record_mismatch");
  assert.equal(audit({session:{...session,metadata:{...session.metadata,listing_id:"INVALID"}}}).status, "invalid_booking_metadata");
});
test("recorded refund is reported for review, not confused with a missing booking", () => {
  assert.deepEqual(audit({booking:{...booking,status:"refunded"}}), {status:"booking_refunded",severity:"review"});
});
test("paid extension matches booking_extensions instead of requiring a new booking row", () => {
  const extra = {...session,metadata:{type:"extension",booking_id:"22",connected_account_id:account,total_cents:"2760"}};
  assert.deepEqual(audit({session:extra,booking:null,extension:{booking_id:22,added_amount:27.60,stripe_connected_account_id:account}}),
    {status:"extension_recorded",severity:"ok"});
  assert.equal(audit({session:extra,booking:null,extension:null}).status,"paid_extension_without_record");
});
test("audit CLI contains no payment or database write operations", async () => {
  const code = await readFile(new URL("../scripts/audit-stripe-checkout-events.mjs",import.meta.url),"utf8");
  assert.match(code,/stripe\.events\.list\(/);
  assert.match(code,/supabase.*createClient|createClient\(/);
  assert.doesNotMatch(code,/stripe\.refunds\.create|stripe\.checkout\.sessions\.create|stripe\.events\.resend|\.upsert\(|\.update\(|\.delete\(|\.insert\(/);
  assert.match(code,/Database URL does not match --db selection/);
  assert.match(code,/Stripe key mode does not match --stripe-mode/);
});
