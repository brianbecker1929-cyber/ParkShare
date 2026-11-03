import zxcvbn from "zxcvbn";

// Shared sign-in and account-creation validation. Keep existing shorter
// passwords sign-in eligible; apply the stronger policy only to NEW secrets.
import { MIN_NEW_PASSWORD_LENGTH } from "./authFormBasics.js";
export { MIN_NEW_PASSWORD_LENGTH, emptyAuthForm, isUnconfirmedEmailError, signupOutcome } from "./authFormBasics.js";

// Local common-password and pattern checks; never send a secret to a scoring
// service. This complements, but cannot replace, the Auth server's policy.
export function validateNewPassword(password) {
  if (typeof password !== "string" || password.length < MIN_NEW_PASSWORD_LENGTH) return `Use at least ${MIN_NEW_PASSWORD_LENGTH} characters`;
  // Bound estimator work for pasted secrets. The full secret remains unchanged.
  if (zxcvbn(password.slice(0, 100), ["ParkShare", "parkshare"]).score < 3) return "Choose a less predictable password. Avoid common passwords, sequences and repeated words; try several unrelated words.";
  return null;
}

export function validateAuthForm(form, screen) {
  const errors = {};
  if (screen === "signup" && !String(form.name || "").trim()) errors.name = "Name required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.email || "").trim())) errors.email = "Enter a valid email";
  const password = String(form.password || "");
  if (screen === "signup") {
    const error = validateNewPassword(password);
    if (error) errors.password = error;
  } else if (screen === "signin" && !password) {
    errors.password = "Enter your password";
  }
  return errors;
}
