import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const modalStart = app.indexOf("function SignInModal(");
const modalEnd = app.indexOf("// ─── Header", modalStart);
const modal = app.slice(modalStart, modalEnd);
const between = (start, end) => modal.slice(modal.indexOf(start), modal.indexOf(end));

test("sign-in and sign-up use real forms, associated labels and password autocomplete", () => {
  const signin = between('{/* Sign in */}', '{/* Password recovery */}');
  const signup = between('{/* Sign up */}', '{/* Role picker */}');
  for (const markup of [signin, signup]) {
    assert.match(markup, /<form\s+onSubmit=/);
    assert.match(markup, /type="submit"/);
    assert.match(markup, /<\/form>/);
    assert.match(markup, /name="email"/);
    assert.match(markup, /name="password"/);
  }
  for (const id of ["ps-signin-email", "ps-signin-password", "ps-signup-name", "ps-signup-email", "ps-signup-password"]) {
    assert.ok(modal.includes('htmlFor="' + id + '"'), id + " has accessible label");
    assert.ok(modal.includes('id="' + id + '"'), id + " has accessible input");
  }
  assert.match(signin, /autoComplete="current-password"/);
  assert.match(signup, /autoComplete="new-password"/);
  assert.match(signup, /minLength=\{MIN_NEW_PASSWORD_LENGTH\}/);
});

test("changing auth screens resets credentials and messages", () => {
  assert.match(modal, /const openAuthScreen = target => \{/);
  for (const name of ["setForm(emptyAuthForm())", "setErrors({})", 'setAuthError("")', 'setAuthSuccess("")']) {
    assert.ok(modal.includes(name), "clears " + name);
  }
  assert.match(modal, /onClick=\{\(\) => openAuthScreen\("signup"\)\}/);
  assert.match(modal, /onClick=\{\(\) => openAuthScreen\("signin"\)\}/);
});

test("confirmation link can be resent on both unconfirmed login and verification screen", () => {
  const login = between('{/* Sign in */}', '{/* Password recovery */}');
  const verification = between('{screen === "verify"', '{/* Header */}'); // slice includes verification markup
  assert.match(modal, /supabase\.auth\.resend\(\{/);
  assert.match(login, /isUnconfirmedEmailError\(authError\)/);
  assert.match(login, /Resend confirmation email/);
  assert.match(verification, /Resend confirmation email/);
  assert.match(modal, /60_000/);
});
