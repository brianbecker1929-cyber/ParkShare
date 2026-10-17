# ParkShare private messaging security — October 17, 2026

## Confirmed code and policy issues

Read-only ParkShare-QA inspection found a messages SELECT RLS policy which grants access based on participation anywhere on a given listing and contains a self-reference to messages. This is not a sound way to isolate conversations; depending on PostgreSQL RLS evaluation it may also fail with recursion. The finding is a confirmed overly permissive/recursive policy design, not proof of any actual customer-to-customer disclosure. QA had four messages, all with recipient_id present; production historical rows have not been inspected.

The public-facing messaging API correctly scopes its GET query to sender or recipient, but a browser can attempt direct Supabase Data API calls independently of that API. Server POST also permitted a Host to provide any participantId for an unbooked listing conversation, without checking that a real conversation existed.

## Proposed isolated fix

- Review-only SQL: docs/sql-proposals/qa-private-messages-rls.sql
  - Replace listing-wide/self-referential read policy with a simple authenticated sender-or-recipient rule.
  - Revoke browser/anonymous direct INSERT/UPDATE/DELETE on messages; continue authenticated SELECT with RLS and service_role server access.
  - Add participant lookup indices.
  - Does not modify the active QA database or production; requires separate coordinated migration before deployment.
- API: Host reply without bookingId can target only a Driver who has previously sent a message to this Host on that SAME listing. Booking-linked messages still require matching original booking and participants. Server continues taking sender_id only from verified JWT.
- CI: authenticated Driver A, Driver B, Host, unrelated user, anonymous and service-role authorization; data-layer write denial, cross-listing reply forgery and valid Host reply tests.

## Release conditions and compatibility

1. Inspect recipient_id IS NULL counts on production before deployment; those legacy rows require reconciliation or explicit support handling. QA had zero such records at inspection time.
2. Test Host initiating booked-Driver messages with bookingId and Host replies to unbooked messages. Ensure email links, booking context and inbox previews still work.
3. Integrate with PR #161 (residential address restrictions) and coordinate all RLS updates with BetterQA. This PR deliberately targets the QA release-candidate branch, not PR #161 or main, to isolate the messaging repair.
4. Verify direct PostgREST reads and writes using anon, Driver A, Driver B and Host tokens against a disposable/approved QA preview environment. Do not use customer messages for test cases.
5. This does not remediate all potential communications abuse, such as rate limits for new inbound Driver enquiries, and should not be marked launch-complete until comprehensive security retests pass.

**No SQL applied to connected databases. No app production or active BetterQA deployment. No payment or live customer message writes.**
