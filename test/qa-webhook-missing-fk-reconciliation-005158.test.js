import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CheckoutIntegrityError } from "../api/_checkout-integrity.js";
import {
  PaidCheckoutReferenceError,
  requirePaidCheckoutReference,
  isForeignKeyReferenceFailure,
  translatePaidBookingInsertError,
  paidCheckoutReferenceLog,
} from "../api/_paid-checkout-reference.js";

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("missing listing, Host or renter profile are reconciliation incidents, not refundable fraud", () => {
  for (const stage of ["listing_lookup", "host_profile_lookup", "renter_profile_lookup", "extension_parent_booking"]) {
    for (const result of [
      { data: null, error: { code: "PGRST116", message: "no rows", status: 406 } },
      { data: null, error: null },
    ]) {
      assert.throws(() => requirePaidCheckoutReference(result, stage), error => {
        assert.equal(error instanceof PaidCheckoutReferenceError, true);
        assert.equal(error instanceof CheckoutIntegrityError, false);
        assert.equal(error.stage, stage);
        assert.equal(error.code, "missing_reference");
        return true;
      });
    }
  }
});

test("healthy existing parent rows are used unmodified", () => {
  const a = { id: "host1", stripe_account_id: "acct_test_host" };
  assert.equal(requirePaidCheckoutReference({ data: a, error: null }, "host_profile_lookup"), a);
});

test("a database outage, permissions error or SQL timeout is propagated, not recast as an FK mismatch", () => {
  for (const e of [
    { code: "42501", status: 403, message: "access denied" },
    { code: "57014", status: 500, message: "statement timeout" },
    { code: "PGRST000", status: 504, message: "gateway timeout" },
    { code: "08006", status: 522, message: "connection lost" },
  ]) {
    assert.throws(() => requirePaidCheckoutReference({ error: e, data: null }, "listing_lookup"),
      err => err === e, e.code);
  }
});

test("PostgreSQL 23503 is a non-refundable missing-parent reconciliation incident", () => {
  const fk = { code: "23503", message: "violates foreign key bookings_listing_id_fkey", details: "customer data" };
  assert.equal(isForeignKeyReferenceFailure(fk), true);
  assert.equal(isForeignKeyReferenceFailure({ code: "23P01" }), false);
  assert.equal(isForeignKeyReferenceFailure({ code: "23505" }), false);
  assert.equal(isForeignKeyReferenceFailure({ code: "42501" }), false);
  assert.equal(isForeignKeyReferenceFailure(null), false);
  const normalized = translatePaidBookingInsertError(fk);
  assert.equal(normalized instanceof PaidCheckoutReferenceError, true);
  assert.equal(normalized.stage, "booking_foreign_key");
  assert.equal(normalized.code, "23503");
  assert.equal(normalized instanceof CheckoutIntegrityError, false);
  assert.equal(normalized.message.includes(fk.details), false);
});

test("other database errors preserve their error identity and existing settlement policy", () => {
  for (const err of [
    { code: "23P01", message: "spot exclusion conflict" },
    { code: "23505", message: "duplicate value" },
    { code: "57014", message: "statement timeout" },
    new Error("database unavailable"),
  ]) assert.equal(translatePaidBookingInsertError(err), err);
});

test("operator log carries payment lookup identifiers but no private raw database or customer data", () => {
  const error = new PaidCheckoutReferenceError("booking_foreign_key", "23503");
  const log = paidCheckoutReferenceLog(error, {
    eventId: "evt_test_2", sessionId: "cs_test_2",
    eventType: "checkout.session.completed", connectedAccountId: "acct_test_host",
    livemode: false, address: "sensitive", metadata: { license_plate: "SECRET" },
  });
  assert.deepEqual(log, {
    issue: "paid_checkout_reference_reconciliation_required",
    stage: "booking_foreign_key", code: "23503",
    eventId: "evt_test_2", sessionId: "cs_test_2",
    eventType: "checkout.session.completed", connectedAccountId: "acct_test_host",
    livemode: false,
    action: "inspect_Stripe_payment_account_mode_and_registered_Supabase_hold_do_not_refund_automatically",
  });
  assert.equal(paidCheckoutReferenceLog(new CheckoutIntegrityError("mismatch"), {}), null);
  assert.doesNotMatch(JSON.stringify(log), /license_plate|SECRET|sensitive/i);
});

test("webhook reserves auto-refunds only for payment-integrity failures, not missing references", async () => {
  const code = await source("../api/stripe-webhook.js");
  const hostStart = code.indexOf("async function hostAccountForListing");
  const hostEnd = code.indexOf("async function validatedIntent", hostStart);
  const host = code.slice(hostStart, hostEnd);
  assert.match(host, /requirePaidCheckoutReference\(\{ data: listing, error: listingError \}, "listing_lookup"\)/);
  assert.match(host, /requirePaidCheckoutReference\(\{ data: host, error: hostError \}, "host_profile_lookup"\)/);
  assert.match(host, /new PaidCheckoutReferenceError\("host_account_unavailable", "account_review"\)/);
  assert.doesNotMatch(host, /if \(!listing\) throw new CheckoutIntegrityError/);
  const booking = code.slice(code.indexOf("async function confirmBooking"), code.indexOf("async function confirmExtension"));
  const validatedAt = booking.indexOf("await validatedIntent(");
  const renterAt = booking.indexOf("requirePaidCheckoutReference({ data: renterProfile, error: renterError }");
  const insertAt = booking.indexOf('.from("bookings")\n    .upsert(');
  assert.ok(validatedAt < renterAt && renterAt < insertAt);
  assert.match(booking, /throw translatePaidBookingInsertError\(error\)/);
  assert.match(booking, /error\.code === "23P01"/);
  const ext = code.slice(code.indexOf("async function confirmExtension"), code.indexOf("async function sendExtensionConfirmedEmail"));
  assert.match(ext, /requirePaidCheckoutReference\(\{ data: booking, error: bookingError \}, "extension_parent_booking"\)/);
  const proc = code.slice(code.indexOf("async function processPaidCheckout"), code.indexOf("export default async function handler"));
  assert.equal((proc.match(/if \(!\(error instanceof CheckoutIntegrityError\)\) throw error/g) || []).length, 2);
  assert.match(code, /paidCheckoutReferenceLog\(error, \{/);
  assert.match(code, /\[paid-checkout-reference\]/);
  assert.match(code, /return res\.status\(500\)\.json\(\{ error: "Webhook processing failed" \}\)/);
});
