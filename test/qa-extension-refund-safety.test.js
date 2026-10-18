import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  validExtensionHours,
  extensionChargeRefundSnapshot,
  requiresManualCancellationForExtensions,
} from "../api/_extension-safety.js";

const source = path => readFile(new URL(path, import.meta.url), "utf8");

test("extension duration is a safe quarter-hour increment, at most 24 hours", () => {
  for (const h of [0.25, 0.5, 1, 1.25, 12.75, 24]) assert.equal(validExtensionHours(h), true);
  for (const h of [0, -1, 0.1, 1.1, 24.25, Number.NaN, Infinity, null, "1"]) {
    assert.equal(validExtensionHours(h), false);
  }
});

test("charge.refunded is cumulative; a partial refund never implies revoked parking time", () => {
  assert.deepEqual(extensionChargeRefundSnapshot({
    amount: 10000, amount_refunded: 1000, refunded: false,
  }), { charge_amount_refunded: 10, charge_fully_refunded: false });
  assert.deepEqual(extensionChargeRefundSnapshot({
    amount: 10000, amount_refunded: 10000, refunded: true,
  }), { charge_amount_refunded: 100, charge_fully_refunded: true });
  assert.equal(extensionChargeRefundSnapshot({
    amount: 10000, amount_refunded: 15000, refunded: true,
  }), null);
  assert.equal(extensionChargeRefundSnapshot({}), null);
});

test("any paid extension requires support cancellation of all separate Stripe charges", () => {
  assert.equal(requiresManualCancellationForExtensions([]), false);
  assert.equal(requiresManualCancellationForExtensions([{ id: 4 }]), true);
  assert.equal(requiresManualCancellationForExtensions(null), false);
});

test("webhook calls one transactional apply, never an independent extension insert then hours update", async () => {
  const webhook = await source("../api/stripe-webhook.js");
  const start = webhook.indexOf("async function confirmExtension(");
  const end = webhook.indexOf("async function sendExtensionConfirmedEmail(", start);
  assert.ok(start >= 0 && end > start);
  const section = webhook.slice(start, end);
  assert.match(section, /supabaseAdmin\.rpc\(\s*"apply_paid_booking_extension"/);
  assert.match(section, /if \(applyError\)[\s\S]*?throw applyError/);
  assert.match(section, /if \(!application\.applied\) return/);
  assert.doesNotMatch(section, /\.from\("booking_extensions"\)\s*\.upsert/);
  assert.doesNotMatch(section, /\.from\("bookings"\)\s*\.update\(\{ hours:/);
  assert.match(section, /if \(!application\.applied\) return[\s\S]*?sendExtensionConfirmedEmail/);
});

test("Stripe extension events write only matching connected-account payment records", async () => {
  const webhook = await source("../api/stripe-webhook.js");
  for (const event of ['case "charge.refunded":', 'case "refund.created":', 'case "charge.dispute.created":']) {
    assert.ok(webhook.includes(event), event);
  }
  const refunded = webhook.slice(webhook.indexOf('case "charge.refunded":'));
  const lifecycle = webhook.slice(webhook.indexOf('case "refund.created":'));
  const dispute = webhook.slice(webhook.indexOf('case "charge.dispute.created":'));
  for (const section of [refunded, lifecycle, dispute]) {
    assert.match(section, /\.from\("booking_extensions"\)/);
    assert.match(section, /\.eq\("stripe_connected_account_id", event\.account\)/);
  }
  assert.match(refunded, /extensionChargeRefundSnapshot/);
  assert.match(lifecycle, /stripe_refund_id: reconciliation\.refundId/);
  assert.match(dispute, /charge_disputed: true/);
});

test("cancel-booking checks paid extensions BEFORE initiating an original-payment refund", async () => {
  const cancel = await source("../api/cancel-booking.js");
  const check = cancel.indexOf('.from("booking_extensions")');
  const create = cancel.indexOf("stripe.refunds.create");
  assert.ok(check > 0 && create > check);
  assert.match(cancel, /if \(extensionError\) throw extensionError/);
  assert.match(cancel, /if \(paidExtensions\?\.length\)[\s\S]*?code: "support_required"/);
});

test("SQL proposal is transactionally atomic and service-role-only, not an applied migration", async () => {
  const sql = await source("../docs/sql-proposals/qa-atomic-extensions-and-refunds.sql");
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /INSERT INTO public\.booking_extensions/);
  assert.match(sql, /UPDATE public\.bookings x SET hours=x\.hours\+p_added_hours/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM public\.bookings/);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC,anon,authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role/);
  assert.match(sql, /NOT execute on live or BetterQA QA databases/);
});

test("new checkout validates added hours before creating Stripe session", async () => {
  const checkout = await source("../api/create-extend-session.js");
  assert.match(checkout, /validExtensionHours\(addedHours\)/);
  assert.ok(checkout.indexOf("validExtensionHours(addedHours)") < checkout.indexOf("stripe.checkout.sessions.create"));
});
