# BUG-005494 — staged browser security headers

Recovery QA only, on the existing QA branch. No production release, database,
provider configuration, financial action or migration is part of this change.

The hosting configuration had no browser security headers other than Vercel's
HSTS. A global `/(.*)` header rule now covers documents, static assets, unknown
paths and API responses. It immediately enforces:

- `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self';`
- `X-Frame-Options: DENY` for older browsers.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy: geolocation=(self), camera=(), microphone=()`.

Vercel's existing HSTS is retained. Top-level navigation to Stripe Checkout or
Connect is unaffected. Blocking ParkShare as a framed document does not block
ParkShare from embedding its own YouTube tutorial or provider frames. Same-origin
geolocation remains available for parking search. Camera and microphone capture
are not used by the parking app; ordinary file uploads remain available.

## Resource-policy rollout

As requested in the ticket, resource restrictions start in a separate
`Content-Security-Policy-Report-Only` header. They do **not** yet block injected
scripts or outbound resource loads. Do not claim full XSS protection or full
resource-policy enforcement from this repair. The enforced anti-framing policy
is separate, so report-only mode does not leave clickjacking protection disabled.

The candidate permits bundled scripts and specific Maps/Stripe script hosts.
The existing inline boot diagnostic is permitted by SHA-256, without generally
permitting inline script. Google Maps currently documents an `unsafe-eval`
compatibility requirement; the candidate retains that exception. React/Maps
inline styles are allowed. Image URLs permit HTTPS, data and blob sources because
the app displays provider images and user-selected uploads; this is deliberately
broader than the script policy. Supabase HTTPS/WebSocket connections, Maps and
Places service requests, Nominatim address lookup, Google Fonts, Stripe frames,
the existing YouTube privacy embed and map blob workers are listed separately.
Supabase storage is not a trusted script origin.

No report collection endpoint or third-party upload was introduced. Use browser
DevTools to inspect report-only violations. A future enforcement change must
follow the integration retest below, with the observed final allowlist reviewed.
Do not add `unsafe-inline` or a blanket HTTPS script source to silence reports.

## Verification and BetterQA acceptance

Automated checks cover all routed paths, static/API/404 patterns, enforced versus
observational directives, provider coverage and the exact inline boot-script hash.
After deployment, inspect GET and HEAD response headers on `/`, `/parking`,
`/profile`, `/help`, `/legal.html`, a nonexistent URL, JS/CSS/image assets and an
unauthenticated API response. Verify 404s, content types, access denial and all
release-readiness checks remain correct.

In a real browser, attempt to embed recovery QA from another origin and verify
the frame refuses to load. Then retest sign-in/recovery, parking geolocation,
Maps/Places/routes, restaurant images, the tutorial video, Host address search,
photo upload, and Stripe TEST checkout/onboarding/return flows. Capture any
report-only violations with affected feature and resource origin. No live
payments, accounts or listings should be created merely to inspect headers.

Keep this ticket Ready for QA pending that browser retest and the resource-policy
enforcement follow-up. Header delivery alone is not complete launch acceptance.

References:

- https://vercel.com/docs/project-configuration/vercel-json#headers
- https://developers.google.com/maps/documentation/javascript/content-security-policy
- https://docs.stripe.com/security/guide
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors
