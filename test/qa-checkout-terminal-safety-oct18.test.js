import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isExpectedCheckoutTermination, matchesRegisteredCheckoutAccount, canFailUnpaidBooking,
} from "../api/_checkout-terminal-safety.js";

const base = {
  id:"cs_test_registered", status:"expired", payment_status:"unpaid", livemode:false,
};

test("expired Checkout cleanup requires current Stripe session to confirm terminal unpaid state", () => {
  const a="acct_registered";
  assert.equal(isExpectedCheckoutTermination(base, { ...base }, "checkout.session.expired", a), true);
  for (const altered of [
    { payment_status:"paid" }, { status:"complete" }, { id:"cs_other" },
    { livemode:true }, { id:null },
  ]) assert.equal(isExpectedCheckoutTermination(base, { ...base, ...altered }, "checkout.session.expired", a), false, JSON.stringify(altered));
  assert.equal(isExpectedCheckoutTermination(base, {...base}, "checkout.session.expired", null), false);
  assert.equal(isExpectedCheckoutTermination({ ...base, payment_status:"paid" }, base, "checkout.session.expired", a), false);
  assert.equal(isExpectedCheckoutTermination({ ...base, livemode:true }, base, "checkout.session.expired", a), false);
});

test("async failed event requires a completed (but unpaid) checkout, not a completed paid booking", () => {
  const terminal = { ...base, status:"complete" };
  assert.equal(isExpectedCheckoutTermination(terminal, { ...terminal }, "checkout.session.async_payment_failed", "acct_test"), true);
  for (const changed of [
    { status:"open" }, { status:"expired" }, { payment_status:"paid" },
  ]) assert.equal(isExpectedCheckoutTermination(terminal, { ...terminal, ...changed }, "checkout.session.async_payment_failed", "acct_test"), false);
  assert.equal(isExpectedCheckoutTermination(terminal, terminal, "checkout.session.completed", "acct_test"), false);
  assert.equal(isExpectedCheckoutTermination({ ...terminal, id: undefined }, terminal, "checkout.session.async_payment_failed", "acct_test"), false);
});

test("an unrelated Host's signed connected-account event cannot target a registered hold or extension", () => {
  const registered = { expected_connected_account_id:"acct_owner" };
  assert.equal(matchesRegisteredCheckoutAccount(registered, "acct_owner"), true);
  assert.equal(matchesRegisteredCheckoutAccount(registered, "acct_other"), false);
  assert.equal(matchesRegisteredCheckoutAccount({ expected_connected_account_id: null }, "acct_owner"), false);
  assert.equal(matchesRegisteredCheckoutAccount({}, "acct_owner"), false);
  assert.equal(matchesRegisteredCheckoutAccount(null, "acct_owner"), false);
});

test("paid, refunded, completed, disputed and mismatched-account bookings are never downgraded", () => {
  for (const booking of [
    { status:"confirmed", paid_at:"2026-10-18T00:00:00Z", stripe_connected_account_id:"acct_owner" },
    { status:"completed", paid_at:"2026-10-18T00:00:00Z", stripe_connected_account_id:"acct_owner" },
    { status:"refunded", paid_at:"2026-10-18T00:00:00Z", stripe_connected_account_id:"acct_owner" },
    { status:"disputed", paid_at:"2026-10-18T00:00:00Z", stripe_connected_account_id:"acct_owner" },
    { status:"pending", paid_at:"2026-10-18T00:00:00Z", stripe_connected_account_id:"acct_owner" },
    { status:"pending", paid_at:null, stripe_connected_account_id:"acct_other" },
    { status:"payment_failed", paid_at:null, stripe_connected_account_id:"acct_owner" },
  ]) assert.equal(canFailUnpaidBooking(booking, "acct_owner"), false, JSON.stringify(booking));
  assert.equal(canFailUnpaidBooking({ status:"pending", paid_at:null, stripe_connected_account_id:"acct_owner" }, "acct_owner"), true);
});

test("signed terminal webhook validates fresh Stripe state BEFORE any destructive database query", async () => {
  const src = await readFile(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
  const start=src.indexOf("async function processCheckoutTermination(event)");
  const end=src.indexOf("export default async function handler(",start);
  assert.ok(start>=0 && end>start);
  const fn=src.slice(start,end);
  const retrieve=fn.indexOf("stripe.checkout.sessions.retrieve(");
  const verify=fn.indexOf("isExpectedCheckoutTermination(");
  const query=fn.indexOf('.from("booking_holds")');
  assert.ok(retrieve>0 && verify>retrieve && query>verify);
  assert.match(fn, /event\.livemode !== session\.livemode/);
  assert.match(fn, /stripeAccount: connectedAccountId/);
  assert.match(fn, /readCheckoutDb\(/);
  assert.match(fn, /if \(booking && !canFailUnpaidBooking\(booking, connectedAccountId\)\) return;/);
  assert.match(fn, /if \(hold && pending\) \{/);
  assert.match(fn, /if \(hold && !matchesRegisteredCheckoutAccount\(hold, connectedAccountId\)\) return;/);
  assert.match(fn, /if \(pending && !matchesRegisteredCheckoutAccount\(pending, connectedAccountId\)\) return;/);
  assert.match(fn, /if \(!hold && !pending && !booking\) return;/);
  assert.match(fn, /from\("booking_holds"\)\.delete\(\)[\s\S]*?\.eq\("expected_connected_account_id", connectedAccountId\)/);
  assert.match(fn, /from\("pending_booking_extensions"\)\.delete\(\)[\s\S]*?\.eq\("expected_connected_account_id", connectedAccountId\)/);
});

test("payment_failed update requires pending, unpaid and exact connected Stripe account", async () => {
  const src=await readFile(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
  const fn=src.slice(src.indexOf("async function processCheckoutTermination(event)"),
                     src.indexOf("export default async function handler"));
  const start=fn.indexOf('.update({ status: "payment_failed" })');
  assert.ok(start>=0);
  const post=fn.slice(start);
  assert.match(post, /\.eq\("stripe_checkout_session_id", session\.id\)/);
  assert.match(post, /\.eq\("stripe_connected_account_id", connectedAccountId\)/);
  assert.match(post, /\.eq\("status", "pending"\)/);
  assert.match(post, /\.is\("paid_at", null\)/);
  assert.doesNotMatch(fn, /stripe\.refunds\.create|stripe\.checkout\.sessions\.expire/);
});

test("failure and expiry cases only delegate to protected cleanup", async () => {
  const src=await readFile(new URL("../api/stripe-webhook.js", import.meta.url), "utf8");
  const sw=src.slice(src.indexOf("switch (event.type)"),src.indexOf('case "account.updated"'));
  assert.match(sw, /case "checkout\.session\.async_payment_failed":\s*case "checkout\.session\.expired":\s*\{\s*await processCheckoutTermination\(event\);/);
  assert.doesNotMatch(sw, /\.from\("booking_holds"\)\.delete\(\)/);
  assert.doesNotMatch(sw, /\.from\("bookings"\)\.update\(\{ status: "payment_failed" \}\)/);
});
