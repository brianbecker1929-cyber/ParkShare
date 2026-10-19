# QA security review: trusted Stripe redirect origins
**October 17, 2026 — draft only; no production merge or active BetterQA QA deployment**

## Source-level finding
Previously `getOrigin(req)` trusted `x-forwarded-proto` and `x-forwarded-host` or `Host` if `APP_URL` was unset. Both `/api/create-checkout-session` and `/api/connect-onboarding` used that result as the destination for Stripe-hosted redirects (checkout success/cancel and Connect return/refresh links). Under a proxy allowing hostile Host/forwarded headers, a request could influence the customer's post-Stripe destination. We **have not** observed an exploit, stolen information or an actual redirect on QA/production.

## Proposed fix
1. Use only a validated server-configured HTTPS `APP_URL` (origin only: no path, userinfo, query or fragment).
2. If `APP_URL` is missing, use a validated trusted deployment `VERCEL_URL` hostname limited to `*.vercel.app`, never incoming forwarded request headers.
3. In **local development only**, permit a strict localhost/127.0.0.1/[::1] Host fallback or explicit local APP_URL.
4. A missing/malformed trusted origin fails closed and does not generate a Stripe destination. `getOrigin` no longer uses request-supplied forwarded headers.
5. Resolve the validated origin before creating a booking hold, Stripe Checkout Session or new Stripe Connect account; misconfiguration cannot leave those side effects behind.
6. Automated regression tests validate allowed and rejected redirect destinations, production vs development, forged headers and order-of-operations checks.

## QA rollout and verification gates
- Verify `APP_URL` is explicitly set to **https://parkshare-qa.vercel.app** in the active QA environment and to **https://www.myparkshare.ca** for production **before** deployment; verify actual configured hostnames with the operations owner instead of relying on this document.
- Preview builds may use `VERCEL_URL` as a trusted fallback. Confirm Vercel-generated preview URLs and the appropriate Stripe TEST return/refresh pages.
- BetterQA should check Stripe TEST checkout success/cancel links and Stripe Connect onboarding return/refresh, including forged `Host`, `X-Forwarded-Host` and `X-Forwarded-Proto` against an isolated deployment; those headers must not influence destinations.
- Confirm invalid APP_URL or missing APP_URL/VERCEL_URL blocks new checkout/onboarding before any booking hold or account creation. Never run actual customer charges to test.
- Coordinate cherry-picks with draft PR #159 because that branch also edits the checkout file and shared `api/_lib.js`.
- No new database columns, migrations or live Stripe transactions needed for the proposed code change. Leave current QA/prod unchanged until approval.

This is a **source-confirmed trust-boundary weakness** with a review-only proposed repair. Keep open until BetterQA verifies deployment configuration and both Stripe TEST flows.
