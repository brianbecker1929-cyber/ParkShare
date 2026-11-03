# QA extension notifications — October 29, 2026

BetterQA verified one paid +1 hour extension on PK-64, Spot A, listing 22
(10 Navy Wharf Court): CAD 12.98 and new departure 9:37 a.m. America/Toronto.
The recovery ledger independently records one applied extension for that booking.

## Email repair
The previous sender addressed the Driver and copied the Host. Both recipients
could see the other's mailbox, and the Host received Driver-specific copy.
The webhook now sends separate private notifications, addressed to the Driver
and Host respectively. The Host message uses William, the Host's greeting,
the Driver's name, vehicle/spot, added duration, new local departure, and a Host
Dashboard link. Its amount is labelled as charged to the Driver, not Host payout.
No recipient is CC'd or BCC'd. Failure of one notification does not suppress
the other; absent Host mail still permits Driver mail, and absent Driver mail
still permits the authoritative Host notification. Shared mailboxes get one mail.

23 focused checks passed locally: private delivery/content, missing or duplicate
mailboxes, provider failures, image fallback, escaping and recovery URL rewriting,
plus initial-booking and extension payout-readiness cases. Full CI/build and fresh
BetterQA inbox receipt are separate gates; do not mark the new emails passed
based only on local tests. Existing paid extension settlement/idempotency is unchanged.

## Retest
On the recovery Preview, pay for a new extension and confirm exactly one time
increment, one private Driver message and one private Host message. Check greetings,
new departure/date and America/Toronto, charged total, branding and dashboard/message
actions. Confirm neither message headers nor body disclose the other email address.

## Incomplete-payout extension fixture
Do not delete/reset an account that owns existing test payments. Do not rewrite
booking payment account IDs, insert synthetic bookings, or change cached readiness
flags as a substitute for Stripe state: the checkout handler reads Stripe directly.
The connected Stripe tool currently has read access only, so no actual account
payout-state mutation has been performed. Host2 reservation PK-65 ended at
2026-10-29T14:58:54.911Z; it cannot exercise an active-session extension guard now.
A fresh active reservation and a reversible actual Stripe TEST account-state
fixture are needed for the manual payouts-disabled extension retest.
A temporary missing-account profile fixture would cover only missing connection,
not actual Stripe payouts-disabled behavior, and must not be reported as equivalent.

All implementation remains on qa/recovery-preflight-oct27, draft PR 252,
QA Vercel project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC, recovery Supabase
heqxirlsorcztsawaldg, and Stripe TEST mode. Production is excluded.
The historical Bremner hold/payment remain untouched.
