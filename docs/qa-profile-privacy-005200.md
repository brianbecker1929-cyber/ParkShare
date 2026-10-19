# BUG-005200 — Profile account-directory exposure

Review-only follow-up to PR #183 (which follows unified candidate #182).
No hosted SQL, active QA promotion or production change has been performed.

## Read-only evidence, October 19, 2026

ParkShare-QA catalog inspection confirms:

- `public.profiles` has row-level security enabled, but its sole SELECT policy,
  `Profiles are viewable by everyone`, permits every row for PUBLIC.
- `anon` and `authenticated` have column-level SELECT grants on `id`, `name`
  and `role`. A missing whole-table SELECT grant therefore does not prevent
  enumeration of those columns.
- No profile-dependent views were found by the dependency query.
- Browser sign-in/signup/cross-tab synchronization requests `id,name,role`
  for the current authenticated user's ID. Other account names needed for
  bookings/messages come from authenticated relationship-scoped server APIs.

The review read policy/permission definitions, not real profile/account rows.

## Draft repair

The existing BUG-005183 integrated privacy proposal already removes the public
profile policy and adds an own-profile SELECT rule. This follow-up names
BUG-005200 explicitly and tightens that same proposal:

1. Add a restrictive own-profile SELECT boundary for authenticated users, so
   an additional permissive read policy cannot reopen cross-account access.
2. Clear browser table/column SELECT grants explicitly and grant only
   `SELECT (id,name,role)` to authenticated users. Anonymous access is denied.
3. Preserve server-role privileges. No changes to profile records, account
   roles, signup triggers, booking data, messaging policies or payment APIs.

The proposal remains part of the coordinated privacy/API cutover. Do not apply
it on its own to the old application, which relies on public profile joins.
It is not a numbered migration or authorization to execute hosted SQL.

## Verification

Eight reusable SQL probes run both in the native PostgreSQL regression suite
and in the complete captured-schema rehearsal. Synthetic fixtures first
reproduce the public policy/column grants: the Driver can see all three test
accounts before the privacy cutover. After the proposal:

- Anonymous projection and count queries fail with permission denied.
- Driver and Host each see only their own sign-in projection.
- Explicit other-account IDs, broad OR filters, counts and pagination cannot
  reveal additional profiles.
- An authenticated role with no identity gets no profile rows.
- Browser reads of email/Stripe columns or SELECT * are denied, even on self.
- An extra permissive SELECT rule still cannot reveal another account.
- Server reads remain available; direct browser role changes/deletion fail.

Existing minimal fixtures now include the real `profiles.name` column required
by the sign-in projection. All nine SQL proposals are rehearsed together.
Local rehearsal uses embedded PostgreSQL 17.5, single client, synthetic rows;
native PostgreSQL CI and application build are separate release checks.

## BetterQA acceptance after coordinated QA deployment

1. Signed out: direct `/rest/v1/profiles?select=id,name,role` and HEAD/count
   requests must be denied.
2. Driver A and Host A: unfiltered reads return only the caller's own row;
   requests for Driver B or Host B return no rows. Test filters and pagination.
3. Request private columns, SELECT * and related joins; ensure no account
   directory, email, Stripe/internal fields or total-account count is exposed.
4. Verify both roles can sign in, confirm signup and resume across browser
   tabs. Retest Host listing management and Driver profile saves.
5. Verify legitimate booking/message participant names, Stripe onboarding and
   booking notification emails still work through scoped server APIs.
6. Check any newly added views/RPCs/caches for equivalent exposure. The catalog
   review is not a full HTTP penetration test or general messaging sign-off.

Keep BUG-005200 open until the reviewed migration/API cutover is deployed and
BetterQA verifies real HTTP authorization. Production requires separate approval.
