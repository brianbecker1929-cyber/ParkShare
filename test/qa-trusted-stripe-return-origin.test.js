import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { trustedStripeReturnOrigin } from "../api/_trusted-stripe-origin.js";

const origin = (overrides = {}) => trustedStripeReturnOrigin({
  nodeEnv: "production",
  ...overrides,
});

test("configured APP_URL takes priority and is normalized to HTTPS origin", () => {
  assert.equal(origin({
    appUrl: "https://parkshare-qa.vercel.app/",
    vercelUrl: "unrelated-preview.vercel.app",
    requestHost: "attacker.invalid",
  }), "https://parkshare-qa.vercel.app");
  assert.equal(origin({
    appUrl: "https://www.myparkshare.ca/",
  }), "https://www.myparkshare.ca");
});

test("production rejects missing trusted origin instead of trusting Host headers", () => {
  for (const maliciousHost of ["attacker.invalid", "www.myparkshare.ca", "evil.invalid:443"]) {
    assert.throws(() => origin({ requestHost: maliciousHost }), /trusted APP_URL or VERCEL_URL/);
  }
});

test("production rejects malformed or unsafe explicit application origins", () => {
  for (const appUrl of [
    "http://www.myparkshare.ca", "https://user:pass@myparkshare.ca",
    "https://myparkshare.ca/checkout", "https://myparkshare.ca/?x=1",
    "https://myparkshare.ca/#section", "javascript:alert(1)",
    "//evil.invalid", "not-a-url",
  ]) {
    assert.throws(() => origin({ appUrl, vercelUrl: "parkshare-qa.vercel.app" }), /APP_URL/, appUrl);
  }
});

test("trusted Vercel platform URL is supported when APP_URL is not set", () => {
  assert.equal(origin({
    vercelUrl: "parkshare-qa-git-fix-eska.vercel.app",
    requestHost: "attacker.invalid",
  }), "https://parkshare-qa-git-fix-eska.vercel.app");
  assert.equal(origin({
    vercelUrl: "parkshare-qa.vercel.app",
    requestHost: "www.myparkshare.ca",
  }), "https://parkshare-qa.vercel.app");
});

test("VERCEL_URL cannot be turned into arbitrary redirect destination", () => {
  for (const vercelUrl of [
    "evil.invalid", "vercel.app.evil.invalid", "https://safe.vercel.app",
    "safe.vercel.app/path", "safe.vercel.app?next=evil.invalid",
    "safe.vercel.app@evil.invalid", "evil..vercel.app", ".vercel.app",
  ]) {
    assert.throws(() => origin({ vercelUrl, requestHost: "evil.invalid" }), /VERCEL_URL/, vercelUrl);
  }
});

test("localhost fallback is only usable outside production, not via spoofed forwarded headers", () => {
  assert.equal(origin({ nodeEnv: "development", requestHost: "localhost:5173" }), "http://localhost:5173");
  assert.equal(origin({ nodeEnv: "development", requestHost: "127.0.0.1:3000" }), "http://127.0.0.1:3000");
  assert.equal(origin({ nodeEnv: "development", requestHost: "[::1]:3000" }), "http://[::1]:3000");
  for (const host of ["evil.invalid", "localhost.evil.invalid", "localhost:99999", "127.0.0.1:0"]) {
    assert.throws(() => origin({ nodeEnv: "development", requestHost: host }), /localhost/, host);
  }
  assert.throws(() => origin({ nodeEnv: "production", appUrl: "http://localhost:3000" }), /APP_URL/);
  assert.equal(origin({ nodeEnv: "development", appUrl: "http://localhost:3000" }), "http://localhost:3000");
});

test("payment and Host onboarding resolve origin before creating a hold or Stripe account", async () => {
  const [lib, checkout, connect] = await Promise.all([
    readFile(new URL("../api/_lib.js", import.meta.url), "utf8"),
    readFile(new URL("../api/create-checkout-session.js", import.meta.url), "utf8"),
    readFile(new URL("../api/connect-onboarding.js", import.meta.url), "utf8"),
  ]);
  assert.match(lib, /trustedStripeReturnOrigin\(/);
  assert.doesNotMatch(lib.slice(lib.indexOf("export function getOrigin"), lib.indexOf("export function jsonMethod")), /x-forwarded-host|x-forwarded-proto/);
  const checkoutOrigin = checkout.indexOf("const origin = getOrigin(req);");
  const checkoutHold = checkout.indexOf("create_booking_hold");
  const checkoutStripe = checkout.indexOf("stripe.checkout.sessions.create");
  assert.ok(checkoutOrigin > 0 && checkoutOrigin < checkoutHold && checkoutOrigin < checkoutStripe);
  const connectOrigin = connect.indexOf("const origin = getOrigin(req);");
  const connectStripe = connect.indexOf("stripe.accounts.create");
  const connectLink = connect.indexOf("stripe.accountLinks.create");
  assert.ok(connectOrigin > 0 && connectOrigin < connectStripe && connectOrigin < connectLink);
});
