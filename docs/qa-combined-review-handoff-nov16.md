# Combined BetterQA review — November 16, 2026

This review combines the complete refund-review source `2090425913fc7eac7dc7addb5d58c23eda891b36`
with PR #257 source `b04a33956394efee39c1272a9f1b8118e925e8f8`.
The cancellation-test merge retains both access-review/refund-copy assertions
and the deadline timer/background/pending-response checks. Application changes
combined without a conflict. No new timezone conversion or cancellation-policy
change is included.

## Target and scope

- Existing review branch: `fix/bug-005672-005673-recovery-nov12`.
- QA Vercel project: `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC`.
- Existing custom environment: `refund-review` (`env_7ueIiIS8poxYMPIMJ1EoVBl5VkEM`).
- Review URL: https://parkshare-qa-git-fix-bug-005672-005673-60a133-eska-technologies.vercel.app
- Existing recovery QA database is shared with frozen QA; this is a separate
  application deployment, not an isolated database clone.
- This combination requires no database migration or environment/credential
  change. Production, frozen QA, standard QA, schedules and operational-alert
  drafts are outside this release.

| Ticket | Required retest |
| --- | --- |
| BUG-005672 | Access-problem support review does not show card-refund timing or promise a refund; normal cancellation keeps its applicable timing. |
| BUG-005673 | Retry the same completed partial refund and confirm the saved result; verify no second refund or Host reimbursement. |
| BUG-005675 | Book Now and Review & pay disclose immediate start, unavailable in-app cancellation and support refund review before payment. |
| BUG-005676 | Invalid Custom durations (0, 0.5, 800) show validation and a native disabled Reserve & pay action; correcting the duration restores normal checks. |
| BUG-005677 | Leave cancellation open across the inclusive one-hour cutoff; refund copy disappears, the required notice appears, and confirmation disables. Pending responses retain their checking state. |

BetterQA requested this combined URL/commit and offered verification within one
working day of receipt. Their financial-flow and independent acceptance results
remain pending. The exact deployed commit and CI/deployment evidence are recorded
in PR #254 rather than placing a circular self-commit reference in this file.

## Vancouver acceptance and resolved report

BetterQA acknowledged the UTC-8 assumption in BUG-005674 was incorrect. B.C.
remained UTC-7; PK-158 and PK-159 were stored correctly. The PK-159 attempt at
approximately 16:40Z was 09:40 Vancouver, 20 minutes before 10:00, so refusal
was correct. BetterQA stated they will close the report as not a bug and remove
it as a Vancouver blocker.

Their coordinated retest will still verify Vancouver cancellation at 80, 60 and
59 minutes using updated timezone data, recording the exact UTC request time
and API response. Expected policy: 80 and exactly 60 minutes are allowed; 59
minutes is refused. No real payment or refund action was used for preparation.

## Separate older-browser display follow-up

The source audit found browser-side formatting in `clientBookingDisplay` and
`formatBookNowTimes`. Both use the visitor runtime's IANA timezone data.
An offline test executed the actual functions with current rules and a local
legacy-rule simulation (America/Los_Angeles as the old Vancouver fallback rule
for these November 2026 samples). This is a compatibility finding, not proof of
the behavior of every browser version.

| Same stored interval | Current-rule rendering | Legacy-rule simulation |
| --- | --- | --- |
| November 12, 17:00Z–18:00Z | 10:00–11:00 Vancouver | 09:00–10:00 Vancouver |
| Book Now preview at 17:00Z | 10:00 local start | 09:00 local start |

The saved start remains 17:00Z in both cases. Actual cancellation-policy checks
at 80/60/59 minutes remain allowed/allowed/refused. This does not reopen the
incorrect-storage report. It is documented separately for browser compatibility
triage; no extra formatting repair is bundled into the five-ticket retest.

## Preservation baseline

Before preparing this combination, the deployed review returned all 15 readiness
checks true at `2090425`; frozen recovery QA returned all 15 true at `072629e`.
Observed production deployment: `dpl_GMV5pX53kVjPVpbaiR5cPqYQStNd`, source
`8c80feab4596e238eb46f585de5b8e1f2cf4b433`.
Observed frozen QA deployment: `dpl_E7X7KCtJ39jZHt97z4aAnDFvkGCa`, source
`072629e16b35970bcae1260ab2e5660ece2b08d8`.
Standard QA was also recorded for post-deployment preservation comparison.
No host data, financial object, webhook event or scheduler is changed by this
preparation. Environment values and credentials are not recorded in the handoff.
