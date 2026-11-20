# BUG-005672 / BUG-005673 review-preview readiness

Prepared November 12, 2026. Configuration and code preparation only.

## Current result

The bug-fix source is on `fix/bug-005672-005673-recovery-nov12`, commit
`6d84741606a13ac257dddc4c73e2485835d2b0f2`, in draft PR #254.
Its QA preview returned HTTP 503 with six failed readiness checks:
`emailConfigured`, `mapsConfigured`, `schemaReady`, `photoCleanupReady`,
`remindersReady`, and `refundNotificationsReady`.

The branch inherits the default QA Preview settings. Its configured Supabase URL
is `https://biydlfekindgaslgktsx.supabase.co`, the older QA backend. The recovery
overrides for email, Maps, backend credentials and cron are scoped to
`qa/recovery-preflight-oct27`, so they do not apply to the bug-fix branch.

The frozen recovery build remains at
`072629e16b35970bcae1260ab2e5660ece2b08d8`, deployment
`dpl_E7X7KCtJ39jZHt97z4aAnDFvkGCa`. It still returned HTTP 200 with all 15 checks
passing. The recovery project `heqxirlsorcztsawaldg` is `ACTIVE_HEALTHY`.
No migration is required by the two bug fixes or this readiness-code change.

## Prepared code

`api/qa-release-status.js` now gives the bug-fix branch its own exact return-URL
binding. This branch cannot report ready while using the older QA backend or
returning users to standard QA, frozen recovery QA or production. Existing
production exclusion, TEST-mode, credentials and schema checks remain blocking.
The endpoint still returns only booleans and the commit, with 15 checks total.

Expected review site:

`https://parkshare-qa-git-fix-bug-005672-005673-60a133-eska-technologies.vercel.app`

The preparation branch is separate from PR #254 to avoid triggering a build in
the empty custom environment before the credential bindings are approved. Keep
this preparation PR draft and unmerged until that setup is ready. Do not push
to the bug-fix branch while its tracked environment is unconfigured.

## Environment prepared

- Team: ESKA Technologies, `team_uKdJGEbDlv6H0MaOmZfU0dQF`.
- Project: `parkshare-qa`, `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC`.
- Custom environment: `refund-review`.
- Environment ID: `env_7ueIiIS8poxYMPIMJ1EoVBl5VkEM`.
- Branch matcher: equals `fix/bug-005672-005673-recovery-nov12`.
- Vercel dashboard showed one included environment, zero additional environments,
  and $0 additional monthly cost. No additional capacity was purchased.
- Environment is empty. No deployment was created in it during this preparation.
- No domains attached. Existing production, standard QA and frozen recovery aliases
  remain unchanged.
- Create New Schedules as Active is off. No worker or scheduler was activated.

This separates deployment configuration; it does **not** create a new database.
The proposed review build uses the existing recovery QA backend. Preparation
must not write to its data or alter its schema, Auth settings, storage or workers.

## Exact credential-binding approval still required

Automatic approval review rejected the first attempt to attach an existing
credential record to the new environment. The stated reason was that preview
preparation did not specifically authorize expanding these credential scopes and
that existing scope preservation needed to be explicit. The attempt made no change.
All 26 original environment records were rechecked with the same type, target,
Git branch and custom-environment associations; zero records belong to
`refund-review`.

The proposed action is to add only this custom-environment ID to each record's
existing `customEnvironmentIds` set. The API request must omit `value`, `target`,
`gitBranch` and `type`; existing values and bindings must be preserved.

| Key | Existing QA source record | Existing scope to retain |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | `7Z4gwO3HTTH3FRJO` | QA project, Preview default |
| `STRIPE_WEBHOOK_SECRET` | `Q04C2XLWdSLfrBhK` | QA Preview, frozen recovery branch |
| `SUPABASE_SERVICE_ROLE_KEY` | `roRnXAvo2p0TVrBB` | QA Preview, frozen recovery branch |
| `RESEND_API_KEY` | `2oZrkIarJz22JyXt` | QA Preview, frozen recovery branch |
| `CRON_SECRET` | `j0RZkkli5BwjwYDy` | QA Preview, frozen recovery branch |

The service-role binding gives the review deployment privileged access to the
recovery QA database; the Resend and cron bindings make email/worker operations
possible if explicitly invoked. No such operation is part of the preparation.
Do not substitute production credentials, widen default Preview scopes, rotate
existing secrets, reveal their values, or bypass the approval rejection.

After approval, verify existing type/target/branch associations after every edit.
Abort on any unexpected scope drift. Verify the new custom-environment query
contains the intended records before publishing a build.

## Config values to add only to refund-review

| Key | Required binding |
| --- | --- |
| `SUPABASE_URL` | `https://heqxirlsorcztsawaldg.supabase.co` |
| `VITE_SUPABASE_URL` | Same recovery URL |
| `SUPABASE_ANON_KEY` | Recovery QA client key |
| `VITE_SUPABASE_ANON_KEY` | Same recovery QA client key |
| `VITE_GOOGLE_MAPS_API_KEY` | Existing recovery QA browser Maps configuration |
| `EMAIL_FROM` | Existing recovery QA sender configuration |
| `APP_URL` | Exact review URL above |

Read Config values through the supported API when needed; do not print their
values, write them to git, or mistake an encrypted response for plaintext.
No Config record has been added to the new environment yet.

## Publish and validate after approval

1. Complete only the exact QA credential and Config bindings described above.
2. Apply this prepared code to the bug-fix branch, preserving the frozen branch.
3. Build that exact commit in `refund-review`. Confirm the Vercel team, QA project,
   custom environment, source branch and commit before publishing.
4. Use only the review alias. Never change production, standard QA or recovery QA
   aliases. If Vercel does not assign the existing review alias automatically,
   assign only that review alias after checking its ownership and deployment.
5. Require HTTP 200, `ready=true`, the exact source commit and all 15 checks true
   from the review release-status endpoint. Check frozen QA remains at the exact
   frozen commit with all 15 checks true.
6. Verify the built browser bundle uses the recovery backend and verify the review
   page loads. A readiness boolean for Maps or email is configuration evidence,
   not proof of provider authorization or actual delivery.
7. Keep schedules inactive. Do not call worker, checkout, refund, payout, email,
   onboarding or webhook-replay routes. Do not create financial test objects.
8. Coordinate BetterQA's retest separately. This preparation neither extends the
   SOW nor changes the frozen regression agreement.

## Validation completed before approval

- 46 focused tests passed, covering readiness, trusted Stripe return origins and
  partial-refund retry safety.
- Full local regression: 1,804 passed, zero failed, two database-dependent skips
  (1,806 test entries total).
- Application build passed.
- The preparation PR's independent CI runs the full tests with a disposable local
  Postgres database and the existing QA schema rehearsal. Hosted migration tools
  and worker setup scripts must not be run.

The production runtime Live-key and signing-secret-distinctness gates from the
earlier production audit remain open. This review-environment task does not close
them and does not alter production.
