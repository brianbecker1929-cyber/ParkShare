import test from "node:test";
import assert from "node:assert/strict";
import { emptyAuthForm, validateAuthForm, MIN_NEW_PASSWORD_LENGTH, isUnconfirmedEmailError, validateNewPassword } from "../src/lib/authForm.js";

test("screen changes start with empty credentials and no stale state", () => {
  assert.deepEqual(emptyAuthForm(), { name: "", email: "", password: "" });
});
test("new account requires 12 characters but sign-in does not break existing passwords", () => {
  assert.equal(MIN_NEW_PASSWORD_LENGTH, 12);
  assert.match(validateAuthForm({ name:"Test Host", email:"host@example.com", password:"123456" }, "signup").password, /12/);
  assert.deepEqual(validateAuthForm({ name:"", email:"host@example.com", password:"123456" }, "signin"), {});
  assert.deepEqual(validateAuthForm({ name:"Test Driver", email:"driver@example.com", password:"a long test passphrase" }, "signup"), {});
});
test("signup validates names and email; sign-in rejects empty secrets", () => {
  const errors = validateAuthForm({ name:"", email:"bad", password:"" }, "signup");
  assert.ok(errors.name && errors.email && errors.password);
  assert.equal(validateAuthForm({ email:"driver@example.com", password:"" }, "signin").password, "Enter your password");
});
test("resend control shown only for Supabase unconfirmed-email errors", () => {
  assert.equal(isUnconfirmedEmailError("Email not confirmed"), true);
  assert.equal(isUnconfirmedEmailError("Invalid login credentials"), false);
});

// Regression for the reported bypass of the length-only form policy.
test("new passwords reject common, sequential and repeated patterns without composition rules", () => {
  for (const password of ["123456789101112", "aaaaaaaaaaaa", "passwordpassword", "qwertyuiopasdf", "Password123!", "ParkShare2026!"]) {
    assert.match(validateNewPassword(password), /less predictable/);
    assert.ok(validateAuthForm({name:"Driver",email:"driver@example.com",password}, "signup").password);
    assert.deepEqual(validateAuthForm({email:"driver@example.com",password}, "signin"), {});
  }
  assert.equal(validateNewPassword("pebble lantern orbit marigold"), null);
});
