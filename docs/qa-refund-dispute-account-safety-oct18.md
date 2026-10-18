# BetterQA — Refund and dispute webhook connected-account safeguards
**ParkShare | 18 October 2026 | Independent review-only payment repair**

## Source-confirmed risk
The existing `charge.refunded`, `refund.created` / `refund.updated` / `refund.failed` and `charge.dispute.created` handlers write to `public.bookings` using only the Stripe `payment_intent` or `charge` ID. They do not include the stored `stripe_connected_account_id` as a database predicate and do not check Supabase UPDATE errors. A zero-match/failed update could be acknowledged with HTTP 200, leaving a genuine payment-reconciliation gap. A stale partial refund could also regress a recorded full refund status. This is a code-confirmed vulnerability, **not evidence of an actual incorrect production refund/dispute**.

## Prepared draft change
- New pure/shared `api/_refund-dispute-account-safety.js`: require an authenticated signed Stripe event's `event.account` in connected-account format, `event.livemode` boolean and typed PaymentIntent/Charge ID; scope every booking UPDATE to BOTH relevant Stripe identifier and the booked `stripe_connected_account_id`.
- Each UPDATE reads `select('id')` and **throws** any Supabase database error, so failed writes result in a retryable HTTP 500 rather than silently responding 200. Correctly identify zero-match updates; an unrelated Host event cannot change another Host's booking.
- Both full and partial `charge.refunded` notifications avoid overwriting terminal `refunded`/`disputed` statuses (idempotent conditional update).
- Refund lifecycle events re-fetch **the current Refund** directly from Stripe within `event.account`, so a delayed `refund.created` event cannot overwrite a later `refund.updated` status with stale data.
- `bookings.stripe_refund_id` currently represents **one** Refund per booking. If another ID is already stored for the same PaymentIntent, the handler fails closed with a structured internal log and HTTP 500, requiring a proper multi-refund reconciliation/ledger instead of overwriting financial history.
- Refund lifecycle UPDATE uses a compare-and-set filter on the prior `stripe_refund_id`, protecting against concurrent changes after the matching-account read.
- Dispute status updates now require both matching `stripe_charge_id` **and** connected account. A late `charge.dispute.created` does not overwrite a completed refund state.
- No refunds, charges, booking hours, listing records, or notification emails were otherwise changed.

## Test plan
- Unit tests: disallow missing/wrong account, event mode, malformed typed identifiers; propagate Supabase errors; verify account and payment filters; zero-match handling; preserve full refund/dispute status; conditional single-refund updates.
- Disposable PostgreSQL tests: two synthetic bookings with same PaymentIntent/Charge ID but different connected accounts, allowing verification that only the owner-matched row changes. Test duplicate refunds, mismatched second refund IDs, and stale partial vs fully refunded state.
- BetterQA Stripe TEST: completed full and partial refund, duplicate/out-of-order refund events, mismatched connected-account delivery, dispute event, Supabase query/update errors, multiple partial refunds for a single booking. Check Stripe dashboard vs stored payment status, Host transaction summary and Driver booking status.
- Examine both Stripe live/test mode and event.account for correct webhook destination. Use test-mode connected accounts only for interaction. Do not replay into live production.

## Known limits and release requirements
- This is a **safety and reconciliation improvement**, not a full multi-refund ledger: legitimate second partial Refund needs policy and schema before it can be accurately recorded. Do not mark multi-refund support complete.
- Current code supports `charge.dispute.created` but not the entire dispute lifecycle. Won/lost/closed disputes and direct extension-charge refund/dispute accounting need separate approved review.
- Extension payment/refund protections are prepared in draft **PR #160**, with at-checkout extension holds in stacked **PR #174**; the exact same switch handles both base-booking and extension events. The different draft implementations **must be integrated and retested together**, not cherry-picked blindly.
- Other webhook dependencies: **#143** trusted checkout registration; **#166** bounded transient Supabase reads; **#175** missing-reference reconciliation; **#177** terminal Checkout cleanup; new refund/dispute safeguards. These are *drafts* on different dependency branches.
- Vercel preview build success and disposable DB tests do NOT validate live Stripe TEST connected-account payments.
- **DRAFT only:** no production merge, active BetterQA QA change, SQL migration, refund, replay, or live Stripe transaction.
