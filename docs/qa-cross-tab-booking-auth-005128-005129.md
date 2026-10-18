# BetterQA BUG-005128 / BUG-005129 — Cross-tab booking authentication state

**Prepared October 18, 2026. Draft application-only fix; nothing merged or deployed.**

## Confirmed source-level failure
The top-level `onAuthStateChange` subscription handles `!session` (sign-out) but never updates the ParkShare profile after `SIGNED_IN` occurs in another tab. The booking panel consumes the stale app-level `user`, so its available vehicles remain empty and "Reserve & pay" stays disabled. Conversely, `SIGNED_OUT` clears the user but the listing checkout control has no contextual explanation for why it is suddenly disabled.

## Prepared repair
- `src/lib/authSessionSync.js` subscribes to Supabase `INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`, `USER_UPDATED`, `SIGNED_OUT`, and password recovery. The latest valid session is checked and the current profile is fetched from Supabase.
- Profile lookup is deferred **outside** `onAuthStateChange` to avoid the documented Supabase client auth-callback deadlock. The generation number cancels out-of-order sign-in/profile queries after sign-out, account switching and component unmount.
- In Browse listing detail, a sign-out closes any unsubmitted payment modal but preserves the selected listing, bay and date/time. A visible `role=status` sign-in prompt appears by the disabled checkout button and opens the normal sign-in modal.
- After the authenticated profile is rehydrated, the saved vehicle selector regains a valid existing/primary vehicle without losing the spot. Signing in through the in-page modal also avoids navigating away from the booking detail.
- The payment API still validates the live JWT and vehicle ownership. Client state synchronization does not bypass server authentication or availability checks.
- No database schema, Stripe Checkout, fees, storage, notifications, or Host listing data are changed.

## BetterQA acceptance tests
1. Tab A: open a specific driveway, choose a rentable spot, vehicle/time; Tab B: sign out. Tab A should show an actionable sign-in notice and disable payment without dropping the chosen spot/time.
2. While Tab A stays on the listing, sign in in Tab B to the same Driver. Tab A should recognize the account, restore complete vehicle selection and enable the button once live availability is confirmed.
3. Sign in directly using Tab A's new prompt and confirm the listing/detail selections are preserved.
4. Tab B: switch to another Driver account. Tab A must use the new account's profile only, never render the previous account's vehicle details or launch Checkout as the old user.
5. Rapid sign-in/sign-out and delayed profile queries must not restore a stale user or allow Checkout without a valid session; invalid/missing profiles should remain unavailable.
6. Refresh Tab A while signed in; `INITIAL_SESSION` restores the profile. Verify desktop/mobile, Host and Driver nav, messages, reviews and bookings are unaffected.
7. After a sign-out before checkout submission, verify the browser disables new payment initiation. An already-submitted request can finish despite sign-out: Supabase access tokens may remain valid until expiry. Verify there is no incorrect success UI or redirect after the payment modal closes, and separately review in-flight checkout/hold expiry behaviour without assuming token revocation.
8. Confirm compatibility with draft PR #147/154 fail-closed spot availability and PR #159 property-local booking times.

## Release gates
Run automated tests and Vercel preview for the exact PR head. BetterQA must reproduce/verify cross-tab auth in an isolated preview. No active BetterQA QA or production environment changes until an approved integration/release window.

**Status: draft, pending checks and BetterQA end-to-end signoff.**
