import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutIntegrityError, verifyPaidCheckout, verifyBookingHoldSnapshot } from "../api/_checkout-integrity.js";

const SESSION_ID = "cs_test_123", HOST_ACCOUNT = "acct_test_host";
const session = { id: SESSION_ID, mode:"payment", payment_status:"paid", amount_total:1150, currency:"cad", payment_intent:"pi_123" };
const intent = { id:"pi_123", status:"succeeded", amount_received:1150, currency:"cad", latest_charge:"ch_123" };
const context = { session, eventAccount:HOST_ACCOUNT, expectedSessionId:SESSION_ID,
  expectedConnectedAccountId:HOST_ACCOUNT, actualHostAccountId:HOST_ACCOUNT,
  expectedTotalCents:1150, paymentIntent:intent };
const hold = { id:"hold_123", listing_id:20, renter_id:"driver_1", spot_label:"A",
  starts_at:"2026-10-15T13:00:00Z", ends_at:"2026-10-15T15:00:00Z",
  expected_connected_account_id:HOST_ACCOUNT, expected_total_cents:1150,
  checkout_metadata:{ hold_id:"hold_123", listing_id:"20", renter_id:"driver_1", connected_account_id:HOST_ACCOUNT,
    hours:"2", subtotal_cents:"1000", service_fee_cents:"150", total_cents:"1150", spot_label:"A" } };

test("accepts an actual matching CAD payment from the correct Host", () => {
  assert.deepEqual(verifyPaidCheckout(context), { paymentIntentId:"pi_123", chargeId:"ch_123" });
  assert.deepEqual(verifyBookingHoldSnapshot(hold), hold.checkout_metadata);
});
test("blocks valid Stripe payments from a different Host", () => {
  assert.throws(() => verifyPaidCheckout({ ...context, eventAccount:"acct_victim" }), CheckoutIntegrityError);
  assert.throws(() => verifyPaidCheckout({ ...context, actualHostAccountId:"acct_other" }), CheckoutIntegrityError);
});
test("blocks fabricated Checkout Sessions even if a connected Host paid", () => {
  assert.throws(() => verifyPaidCheckout({ ...context, session:{ ...session, id:"cs_test_fake" } }), CheckoutIntegrityError);
  assert.throws(() => verifyPaidCheckout({ ...context, expectedSessionId:"cs_test_wrong" }), CheckoutIntegrityError);
});
test("blocks underpayments, incorrect currency and unconfirmed intent", () => {
  assert.throws(() => verifyPaidCheckout({ ...context, session:{ ...session, amount_total:50 } }), CheckoutIntegrityError);
  assert.throws(() => verifyPaidCheckout({ ...context, session:{ ...session, currency:"usd" } }), CheckoutIntegrityError);
  assert.throws(() => verifyPaidCheckout({ ...context, paymentIntent:{ ...intent, amount_received:50 } }), CheckoutIntegrityError);
  assert.throws(() => verifyPaidCheckout({ ...context, paymentIntent:{ ...intent, status:"processing" } }), CheckoutIntegrityError);
});
test("blocks metadata replay onto another reservation or changed duration", () => {
  assert.throws(() => verifyBookingHoldSnapshot({ ...hold, listing_id:999 }), CheckoutIntegrityError);
  assert.throws(() => verifyBookingHoldSnapshot({ ...hold, expected_total_cents:50 }), CheckoutIntegrityError);
  assert.throws(() => verifyBookingHoldSnapshot({ ...hold, ends_at:"2026-10-16T15:00:00Z" }), CheckoutIntegrityError);
  assert.throws(() => verifyBookingHoldSnapshot({ ...hold, checkout_metadata:null }), CheckoutIntegrityError);
});
