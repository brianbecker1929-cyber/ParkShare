# BUG-005462: explain checkout limits and verify automatic recovery

Scope: recovery QA (`heqxirlsorcztsawaldg`), branch
`qa/recovery-preflight-oct27`, Stripe TEST. Keep PR 252 draft/unmerged.

## Diagnosis

BetterQA's October 30 follow-up correctly distinguishes the released spot
from the continuing `checkout_rate_limited` response. The existing database
function enforces three independent limits, shared by booking and extension:

| Limit | When a blocked request becomes eligible again |
| --- | --- |
| Two active unpaid holds | Enough active holds expire, complete or are cancelled to leave fewer than two |
| Four starts in a rolling two hours | Enough prior starts age out to leave fewer than four |
| Twelve starts in a rolling 24 hours | Enough prior starts age out to leave fewer than twelve |

The recovery audit contains FOUR starts for the reported Driver on October 30:
18:06:11, 18:29:53, 19:00:36 and 19:01:51 UTC. The earlier 18:06 start was
not listed in the QA comment. At 19:32 all four were inside the two-hour
window, so a 429 was expected even though the parking spots were free.
With no additional successful starts, this two-hour block ended at 20:06:11,
not 30 minutes after the most recent hold. At inspection October 31 19:10 UTC
the Driver had zero active holds, zero starts in two hours and zero in 24
hours. This is not evidence of a permanent counter lockout.

The bug in the application response is that it gave no reason or recovery
time, and extensions incorrectly described every quota as active checkouts.
Do not clear the audit or silently remove BUG-005118 abuse protection to make
the original ticket's 30-minute counter-reset assumption true.

## Change

The guarded migration replaces only the hold function's quota-refusal block.
The same thresholds and predicates remain. It computes the exact expiry that
leaves capacity under each limit, then returns the latest of those instants
so a retry is not prematurely advised while another quota still blocks it.
The SQLSTATE remains `P0058`; its versioned JSON detail includes the governing
reason, currently blocked limits and retry instant. No account or hold IDs
are exposed. Advisory-lock ordering and all capacity/payment logic remain.
The migration asserts unchanged ownership, ACL, security mode and configuration.

Both checkout APIs return safe plain-language copy, `retryAt`,
`retryAfterSeconds`, the existing `checkout_rate_limited` code, and an HTTP
`Retry-After` header. No Stripe session is created on rejection. A legacy or
malformed database response receives a safe generic temporary-limit message.
The existing frontend displays the returned error text. This is an explanatory
wait estimate, not a live browser countdown. New successful starts can move it.

No hold/audit/payment data is deleted or reset, and Stripe webhook destinations,
fees, paid settlement, refunds and production remain unchanged.

## Verification / BetterQA acceptance

- Handler tests cover both booking and extension, refusal before Stripe,
  reason-specific copy, wait rounding, malformed details, and a successful
  subsequent request once the database permits it.
- Native PostgreSQL tests cover the reported four-start timeline; expired
  holds versus rolling quotas; two-hour and daily boundary recovery without
  deleting history; legacy excess active holds; combined limits; concurrency;
  unchanged permissions; and a repeatable migration.
- The full-schema rehearsal applies this actual migration after the existing
  proposals, preserving its real booking constraints and extension path.

Retest fresh unpaid TEST checkouts on the recovery URL. Two genuinely open
checkouts should block a third with the active-checkout explanation. When
those leases expire/cancel and no rolling threshold is reached, another
checkout must be allowed. Separately reach four starts in two hours: expect
the two-hour explanation and a finite retry instant, even if all spots have
released. With no new starts, retry after that instant and confirm checkout
opens without staff resetting the account. Verify both booking and Add time,
another Driver's independence, and no Stripe session on a 429.

The existing 30-minute spot release is distinct from checkout-start quotas.
If the product owner chooses to change these thresholds later, treat that as
an explicit product-policy change. Keep this ticket open pending BetterQA's
targeted acceptance; this repair does not claim a fresh hosted payment pass.
