// Shared sign-in and account-creation validation. Keep existing shorter
// passwords sign-in eligible; apply the stronger policy only to NEW secrets.
export const MIN_NEW_PASSWORD_LENGTH = 12;

export function emptyAuthForm() {
  return { name: "", email: "", password: "" };
}

export function validateAuthForm(form, screen) {
  const errors = {};
  if (screen === "signup" && !String(form.name || "").trim()) errors.name = "Name required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.email || "").trim())) errors.email = "Enter a valid email";
  const password = String(form.password || "");
  if (screen === "signup" && password.length < MIN_NEW_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_NEW_PASSWORD_LENGTH} characters`;
  } else if (screen === "signin" && !password) {
    errors.password = "Enter your password";
  }
  return errors;
}

export function isUnconfirmedEmailError(message) {
  return /email\s+not\s+confirmed/i.test(String(message || ""));
}

// Supabase can deliberately return a user without a session for BOTH a new
// unconfirmed address and an already-registered address. Neither proves that
// a new account or a confirmation email was created.
export function signupOutcome(data, error) {
  if (error) {
    if (["user_already_exists", "email_exists"].includes(error.code)
        || /already (?:been )?(?:registered|exists)/i.test(error.message || "")) return { kind: "pending" };
    return { kind: "error", message: error.message || "Unable to sign up. Please try again." };
  }
  if (!data?.user?.id) return { kind: "error", message: "Unable to confirm sign-up. Please try again or sign in." };
  return { kind: data.session ? "authenticated" : "pending" };
}
