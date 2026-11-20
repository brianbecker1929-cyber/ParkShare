// Lightweight account helpers: safe to load without the password estimator.
export const MIN_NEW_PASSWORD_LENGTH = 12;

export function emptyAuthForm() {
  return { name: "", email: "", password: "" };
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
