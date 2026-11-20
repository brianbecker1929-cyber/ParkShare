# BUG-005536: private chat notifications

The message endpoint previously saved a chat without requesting a notification email. The new delivery queue is separate from booking confirmation and session-reminder delivery.

## Behavior

- A future successful message insert creates one private email job in the same transaction. Failed/rolled-back inserts create neither. Historical conversations are not replayed.
- The existing authenticated message endpoint and its participant checks remain. The worker independently verifies listing/booking ownership and established Host replies before selecting the other participant's current profile email.
- Notifications contain a generic new-message notice and a QA-aware sign-in link. They omit message text, names, addresses and contact details. There is one recipient, with no CC, BCC or personal Reply-To.
- The existing protected minute reminder job will process at most five pending chat notices per invocation. Sending mail stays outside the chat HTTP request, so provider outages do not cause a saved message to report a failed send.
- A conditional two-minute database lease serializes workers. The first provider payload is persisted before sending; retries reuse that exact body and a database-scoped message idempotency key. A lost acceptance-marker write cannot create a second provider delivery within its key window.
- Permanent API errors, unsafe/changed recipients or extra addressing, and stale jobs are blocked for reconciliation. Network/server/rate-limit failures retry after their lease. Retries stop before the provider's 24-hour idempotency cache expires. `sent_at` means provider acceptance, not inbox delivery.

## Rollout

1. Rehearse `docs/sql-proposals/qa-message-notifications-005536.sql` in the disposable PostgreSQL CI database. The proposal adds a private RLS queue and an invoker trigger, without elevating client privileges.
2. Apply the approved additive proposal to the recovery QA database only.
3. Enable the helper in the existing protected reminder endpoint. No new cron or credentials are needed.
4. Verify a scheduled invocation can read the queue, and inspect its acceptance/failure counts. Do not backfill old chats or send a test message on another person's behalf.

## Acceptance

BetterQA should use a fresh authorized Driver/Host conversation and inboxes that accept current app mail. Check one recipient-only notification in both directions, the booking link's sign-in/participant access control, and that a rejected chat write sends no email. Check normal confirmations, Host notices and halfway/ending reminders independently. Inbox receipt and reminder privacy headers remain manual acceptance; this code does not resolve a receiving-provider rejection.

Unit coverage includes recipient isolation, forged/unrelated recipients, enquiry/reply rules, generic private content, QA links, concurrent claims, marker-loss retries, recipient changes, unsafe snapshots, stale jobs, API errors, batch limits and deadlines. The full-schema rehearsal verifies the real trigger, rollback behavior, client denial, independent-connection claims and deletion cleanup.
