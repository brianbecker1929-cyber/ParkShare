import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadTransactionHistory } from "../api/_transaction-history.js";

test("healthy Stripe payouts and recorded booking history are returned together", async () => {
  const spent = [{ id: "booking-1" }];
  const earned = [{ id: "booking-2" }];
  const payouts = [{ id: "po_123", amount: 13.25 }];
  const result = await loadTransactionHistory({
    loadSpent: async () => spent,
    loadEarned: async () => earned,
    loadPayouts: async () => payouts,
  });
  assert.deepEqual(result, { spent, earned, payouts, payoutsUnavailable: false });
});

test("missing connected account is not incorrectly shown as a Stripe outage", async () => {
  const result = await loadTransactionHistory({
    loadSpent: () => [{ id: "booking-1" }],
    loadEarned: () => [],
    loadPayouts: () => [],
  });
  assert.deepEqual(result.payouts, []);
  assert.equal(result.payoutsUnavailable, false);
});

test("Stripe payout read failure leaves Driver payments and Host earnings visible", async () => {
  const err = Object.assign(new Error("secret Stripe error"), { code: "account_invalid" });
  const warnings = [];
  const result = await loadTransactionHistory({
    loadSpent: async () => [{ id: "driver-payment", amount: 9 }],
    loadEarned: async () => [{ id: "host-earning", net: 6 }],
    loadPayouts: async () => { throw err; },
    onPayoutError: (error) => warnings.push(error.code),
  });
  assert.deepEqual(result, {
    spent: [{ id: "driver-payment", amount: 9 }],
    earned: [{ id: "host-earning", net: 6 }],
    payouts: [],
    payoutsUnavailable: true,
  });
  assert.deepEqual(warnings, ["account_invalid"]);
  assert.equal(JSON.stringify(result).includes("secret Stripe error"), false);
});

test("synchronous Stripe exception and failed logging cannot blank transactions", async () => {
  const result = await loadTransactionHistory({
    loadSpent: () => [{ id: "payment-1" }],
    loadEarned: () => [{ id: "earning-1" }],
    loadPayouts: () => { throw new Error("Stripe SDK failed"); },
    onPayoutError: () => { throw new Error("logger error"); },
  });
  assert.deepEqual(result.spent, [{ id: "payment-1" }]);
  assert.deepEqual(result.earned, [{ id: "earning-1" }]);
  assert.deepEqual(result.payouts, []);
  assert.equal(result.payoutsUnavailable, true);
});

test("database read failures still reject rather than showing falsely empty financial history", async () => {
  for (const failedSection of ["spent", "earned"]) {
    await assert.rejects(
      loadTransactionHistory({
        loadSpent: () => failedSection === "spent" ? Promise.reject(new Error("DB failed")) : Promise.resolve([]),
        loadEarned: () => failedSection === "earned" ? Promise.reject(new Error("DB failed")) : Promise.resolve([]),
        loadPayouts: () => Promise.reject(new Error("Stripe unavailable")),
      }),
      /DB failed/
    );
  }
});

test("API and UI distinguish unavailable Stripe data from zero payouts", async () => {
  const [api, app] = await Promise.all([
    readFile(new URL("../api/transactions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(api, /requireUser\(req, res\)/);
  assert.match(api, /loadTransactionHistory\(/);
  assert.match(app, /payoutsUnavailable: Boolean\(json\.payoutsUnavailable\)/);
  assert.match(app, /section === "payouts" && data\.payoutsUnavailable/);
  assert.match(app, /section === "payouts" && !data\.payoutsUnavailable && data\.payouts\.length === 0/);
  assert.match(app, /Stripe payout history is temporarily unavailable/);
});
