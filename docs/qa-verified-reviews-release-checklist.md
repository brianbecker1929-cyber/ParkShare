# ParkShare Verified Reviews — independent QA pre-launch improvement
October 17, 2026 | PR #163 | **DRAFT, not deployed**

## Verified problem
The active BetterQA QA reviews INSERT policy previously required only auth.uid() = user_id, allowing signed-in users to write a review without a matching paid/finished booking. Direct Supabase browser INSERTs bypassed application checks. There was also no unique (listing_id, user_id) constraint, allowing repeated reviews per Driver/listing.

Read-only QA inspection: 1 review, 0 duplicate Driver/listing groups, 0 reviews lacking a linked paid booking. This is QA only, NOT evidence about historical production review data.

## Prepared implementation
- /api/reviews requires a verified bearer session and checks that the submitted listing exists, is not the user's own Host listing, and has at least one eligible prior booking for THAT Driver AND listing.
- A booking must be paid, have an associated trusted Stripe checkout session, valid duration and scheduled start data, be confirmed/completed (not refunded/disputed/cancelled), and have a session end before now.
- The server always inserts user_id from the verified token, never request body. Ratings and review text have strict validation.
- Both React review forms now POST /api/reviews instead of inserting directly through Supabase.
- A separate review-only SQL proposal under docs/sql-proposals/qa-verified-reviews.sql revokes browser INSERT and adds a unique (listing_id,user_id) index to make simultaneous duplicate submissions impossible.
- The HTTP and PostgreSQL tests confirm spoofing, duplicate prevention, invalid payment windows, Host self-reviews, browser INSERT privilege restrictions and authorized server writes.

## Dependencies and QA release gates
1. Inspect production duplicate review groups and historical unverified reviews before introducing uniqueness. Do not delete or modify historical reviews without an approved decision.
2. Coordinate review policies with the address/reviewer privacy PR #161. That PR changes public review READ access; this PR changes review INSERT access. Test both after integration.
3. BOOKING TIMEZONE ISSUE BUG-005156 / PR #159 remains unresolved. Scheduled booking end times are derived by the existing booking-time helper, which currently assumes UTC rather than the property-local timezone. An early/late eligibility decision is possible until that separate fix is integrated. Do not treat this as fully launch-ready in isolation.
4. Test a real Stripe TEST checkout through booking completion, then review submission, second submission, refund/dispute, Host self-review, unbooked Driver, and two Drivers reviewing the same listing. Verify review read/display and mobile experience.
5. Consider a moderation rule for free-text reviews before making text publicly visible, because it may include a property's full residential address. This is covered by PR #161's temporary public-text exclusion.
6. The SQL proposal is NOT an applied migration. Prepare a reviewed Supabase migration in an isolated test environment after BetterQA approves the coordinated release. Do not deploy the app code before database constraints are applied, because double submissions could race.

## Verified test status
GitHub Actions run #366 on commit adfda6bf5de9577f19619a1c36a267278d4ad43c: 240 tests passed, 0 failed, including PostgreSQL disposable-database tests. Both Vercel preview builds passed.

No GitHub merge, no production changes, no active BetterQA QA schema changes, and no Stripe transactions have been initiated for this repair.
