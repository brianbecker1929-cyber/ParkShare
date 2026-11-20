# ParkShare production cutover — November 20, 2026

ParkShare is online on the approved combined release. The production engine and application database updates completed within the approved maintenance window. No controlled live charge/refund was performed.

| Item | Verified outcome |
| --- | --- |
| Public site | https://www.myparkshare.ca |
| Production commit | `d1e665dc779a5b456fc029bf98ca595da72ac674` |
| Deployment | `dpl_HCkWVBW9PqnPMbLYzkP4p6uXebmY`, READY |
| Database | `oyxrussraxjgqwzpwyca`, ACTIVE_HEALTHY, Supabase 17.12.0.000 |
| API/Auth | PostgREST 14.18; Auth 2.198.0; HTTP checks passed |
| Matching migration | `20261120120118`, `production_release_candidate` |
| Reviewed SQL SHA-256 | `6ebb9d4fe84eac2db5a0039fddadc0cf0824e30d673beab254701ae837eaa35a` |
| Runtime integration marker | `1e959342d56c5b15118e73edd51d3d14ea3691fa` |
| Recovery checkpoint | Completed physical backup November 20, 11:52:48 UTC |
| Maintenance | Approximately 31 minutes; temporary 503 routes removed |

The managed engine upgrade ran once. Post-engine counts and sequence positions matched the paused baseline. All 10 hosted timezone cases passed, including corrected Vancouver rules and Toronto's two/four-hour spring/autumn spans. All 31 non-extension function bodies matched the prior fixture; trigger, index, structural and effective-grant comparisons also matched. Only Vault's provider extension version changed (0.3.1 to 0.3.2; zero secrets), plus raw ACL order on auth.jwt. No application SQL payload needed revision.

The single application migration committed with its internal original-column/value preservation guards passing. All 29 bookings, two extensions, 13 listings and 15 profiles remain. All new financial, email, reminder, alert and photo-cleanup queues started empty; browser money/delivery access checks passed. Counts alone are not a full private-row equality audit.

Six public HTTP checks passed: home and public parking return 200; precise location and reminders reject unauthenticated access; Checkout rejects GET; the QA-only status endpoint returns 404. Production has no noindex header/meta. The parking page and Google Maps rendered in the browser, including the existing Host session. The deployment's recent error/fatal log scan was empty. Scheduled reminder/refund/message runs reported zero sends and zero failures; the operator sent no transactional email or financial request.

## Remaining launch work

- All 13 legacy listings still need legitimate trusted timezone assignment after location review. Earlier location/owner-role flags also need review; no guessed locations, Host promotions or paid-booking rewrites were made.
- Verify live Stripe/Host charge and payout eligibility, then perform one separately authorized controlled live booking/refund.
- PR #260 remains draft/unmerged. Production was deployed directly from the approved commit. QA tracks main with automatic domain assignment, so merging main can replace QA. Automatic review rejected the proposed temporary QA build/domain hold because production approval did not specifically authorize QA configuration changes. No QA setting or active deployment changed. A temporary QA hold, merge and immediate settings restoration needs explicit authorization.
- Preserve the historical completed CAD 13.80 TEST Checkout discrepancy for reconciliation; it has no matching production or recovery-QA booking. No event replay or refund was performed.

SOW 1 and BUG-005823's BetterQA v5 retest remain complete. SOW 2 is optional. The two stale-refund-snapshot improvements and other documented nonblocking follow-ups remain separate.

Detailed aggregate evidence: `deployment/production-database/evidence/production-cutover-nov20.json`. Public-site screenshot: `deployment/production-database/evidence/production-live-nov20.jpg`.
