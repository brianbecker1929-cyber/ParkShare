# BUG-005495: preserve the homepage's first paint

Scope: recovery QA branch and draft PR 252. No production promotion, dependency upgrade, database change or payment configuration change.

## Evidence before this repair

The prior image optimization reduced mobile LCP to 3.001 seconds, above the 2.5-second acceptance target. A fresh pre-change PageSpeed mobile run on build `ca48f93` reproduced 3.001s LCP, 2.455s FCP, zero TBT/CLS and performance 89:

https://pagespeed.web.dev/analysis/https-parkshare-qa-git-qa-recovery-preflight-oct27-eska-technologies-vercel-app/tvy319wqf6?form_factor=mobile

Protocol: PageSpeed Insights, Lighthouse 13.6, emulated Moto G Power, Slow 4G, initial cold load. The report also identifies a separate render-blocking stylesheet request (estimated 300ms).

The static public document previously lived outside React's empty root. Once the main JavaScript loaded, `createRoot` rendered a second homepage and removed the first document. The resulting hero/heading were new DOM nodes.

## Implementation

- Build the actual anonymous App tree for the homepage using `renderToString`, with all services and network access disabled during rendering. It contains no account or booking state.
- Use `hydrateRoot` on that homepage markup so React attaches handlers to the initial image, heading and navigation rather than replacing them. The authored static header stylesheet preserves raw CSS characters, preventing a text mismatch that would force a client rebuild.
- Embed the exact compiled stylesheet on the homepage, after its responsive hero preload. Other routes retain the ordinary stylesheet link. No hand-maintained critical-CSS subset is introduced, so subsequent SPA screens retain their styles.
- Keep native read-only navigation in a no-JavaScript fallback. Rebuilding removes the prior home root/fallback/styles before regenerating route documents.
- Retain ordinary client mounting for private/non-home routes, absent server markup and sensitive booking/payment/message/auth return parameters or credential hashes. Ordinary marketing/cache-busting homepage queries can hydrate.

## Verification and retest

The actual production main/App entry is tested against the real build renderer using synthetic services. It must preserve the original hero and heading node identities with no hydration mismatch, then open/close the account dialog and navigate to About successfully. Tests also cover no-JavaScript navigation, sensitive-return selection, exact CSS preservation/order, repeat builds and unchanged private-route roots.

Related public-content, route metadata, responsive image, deferred-account validation and initial JavaScript budget checks remain required. Live verification must check the served build SHA/readiness, browser navigation/account controls and repeated mobile PageSpeed measurements. The 2.5-second target is established only by those deployed measurements; BetterQA retains final acceptance.

References: https://react.dev/reference/react-dom/client/hydrateRoot and https://web.dev/articles/optimize-lcp
