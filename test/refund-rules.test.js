import assert from "node:assert/strict";
import test from "node:test";

import {
  disputeReconciliation,
  refundReconciliation,
  stripeObjectId,
} from "../api/_refund-rules.js";

test("Stripe identifiers accept expanded objects and unexpanded strings", () => {
  assert.equal(stripeObjectId("pi_123"), "pi_123");
  assert.equal(stripeObjectId({ id: "ch_123" }), "ch_123");
  assert.equal(stripeObjectId({}), null);
  assert.equal(stripeObjectId(null), null);
});

test("a full refund reconciles the booking as refunded", () => {
  assert.deepEqual(refundReconciliation({ payment_intent: "pi_full", refunded: true }), {
    paymentIntentId: "pi_full",
    status: "refunded",
  });
});

test("a partial refund reconciles the booking as partially refunded", () => {
  assert.deepEqual(refundReconciliation({ payment_intent: { id: "pi_partial" }, refunded: false }), {
    paymentIntentId: "pi_partial",
    status: "partially_refunded",
  });
});

test("refund events without a payment intent cannot update a booking", () => {
  assert.equal(refundReconciliation({ refunded: true }), null);
});

test("a dispute reconciles by the originating Stripe charge", () => {
  assert.deepEqual(disputeReconciliation({ charge: { id: "ch_disputed" } }), {
    chargeId: "ch_disputed",
    status: "disputed",
  });
  assert.equal(disputeReconciliation({}), null);
});
