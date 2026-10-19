# BUG-005119 — Integrated private messaging repair

Review-only follow-up to PR #184, preserving the #183 booking repair and
#182/#161 paid-address privacy behavior. Incorporates the relevant safeguards
from independent draft PR #162, reconciled with the newer API.

## Read-only QA evidence — October 19, 2026

- Existing message SELECT policy uses listing-wide participation and a
  self-referential messages subquery. This permits inappropriate eligibility
  and can trigger PostgreSQL recursive-policy errors. It is not evidence that
  actual private messages were disclosed.
- Browser roles have broad direct message grants; the INSERT policy checks
  only that sender_id matches the caller. Recipient selection must be owned
  by the authenticated server endpoint instead.
- QA has four message rows, none with a missing recipient or self-recipient.
  Only counts and catalog definitions were read, not message contents.
- No message-dependent views or public message-reading functions were found
  by the catalog dependency/source queries. Production history was not read.

## Integrated behavior

- Direct message SELECT is limited to the actual sender or recipient. A
  restrictive participant policy prevents an additional permissive rule from
  widening access. The recursive/listing-wide rule is removed.
- Direct browser writes are revoked. The server retains message read/write
  privileges, and always derives sender_id from the verified JWT.
- A Host reply without bookingId requires prior incoming contact from that
  recipient to this Host on the same listing. A Host-sent row alone is not
  sufficient proof. Booking-linked sends validate the booking and listing.
- Malformed explicit booking/listing IDs are rejected instead of falling back
  to a broader listing conversation. Client recipient/sender fields cannot
  override the server-selected parties.
- Existing paid-location checks on email booking context remain intact.
  An unpaid/cancelled enquiry also receives a generic inbox listing title,
  since listing.title can itself contain an exact street address. The owning
  Host and entitled paid Driver retain the identifying listing title.
- API failures return generic messages and log only error codes.

No actual messages are sent or altered by preparing this branch. It does not
add new contact privileges, role switching, rate limits or financial actions.

## Verification

The previous Host-reply tests from PR #162 are retained. Six of the 16 new
handler regressions fail against the unpatched #184 API; all 16 pass after
integration. Requests use the installed Supabase client with every HTTP call
intercepted at a synthetic .invalid endpoint. No real inbox is contacted.

Eight reusable SQL probes run in native PostgreSQL tests and in the complete
captured-schema rehearsal. They verify Driver A/B isolation on the same
listing, actual Host participation, unrelated/missing identities, anonymous
denial, browser INSERT/UPDATE/DELETE/TRUNCATE denial, restrictive-policy
behavior, private counts and service-role insertion. A synthetic row with NULL
recipient remains sender-only; the repair does not infer historical parties.

The messaging proposal is the tenth proposal, after account-retention SQL.
All ten are rehearsed with the captured QA application schema. Controlled
review-collision recovery resumes only uncommitted proposals 7–10; this does
not establish an all-stage rollback or managed-service backup recovery.

## Coordinated release and BetterQA acceptance

1. Review this integrated API and the review-only
   `docs/sql-proposals/qa-private-messages-rls.sql` with the full privacy release.
   Do not overwrite the newer API with PR #162's older booking-context code.
2. Before an approved deployment, inventory production recipient NULLs and
   relationship integrity read-only. Reconcile historical rows separately;
   no legacy message identity is backfilled by this draft.
3. In a disposable or coordinated QA window, use two Drivers, a Host and an
   unrelated Host on the same listing. Confirm each Driver sees only their
   own conversation and the Host sees the correct selected thread.
4. Test direct PostgREST reads, filtered counts and writes with all four
   identities plus anonymous requests. Browser writes must be denied while
   valid authenticated API sends succeed.
5. Reject forged recipients, cross-listing replies, other users' bookings and
   malformed IDs. Verify an actual unbooked incoming enquiry permits a Host
   reply, and booking-card initiation resolves the booked Driver correctly.
6. Verify inbox previews and email booking links: identifying titles/addresses
   require paid entitlement or ownership. Cancellation/unpaid context remains
   private. Legitimate participant names still load with BUG-005200 rules.
7. Retest desktop/mobile inboxes, booking links, post-login access and normal
   reply flow before closing BUG-005119.

**No hosted SQL, live message writes, customer communications, active QA
promotion, production merge/deployment or Stripe action.** Keep BUG-005119
open until coordinated deployment and BetterQA HTTP/end-to-end sign-off.
