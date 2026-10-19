# BUG-005188 — Remaining Host proceeds after refunds

Review-only follow-up to PR #185; retains its messaging, profile/address
privacy, booking-time and unified SQL changes. No new SQL proposal or migration.

## Confirmed defect

`hostTransactionPresentation()` excluded every partially_refunded transaction
from dashboard totals. `/api/transactions` meanwhile returned the original
subtotal as Host net, omitted refund evidence from its query and estimated an
extension's fee split. A partially refunded booking therefore disappeared from
earnings while its transaction detail could still show the original amount.

The stored booking refund_amount describes a single Refund object. It does not
establish cumulative successful refunds or how much application fee was
returned. This repair does not invent a proportional-fee policy.

## Reporting calculation and scope

All calculations use integer cents. Remaining proceeds are:

`original charge − successful customer refunds − (original application fee − returned application fee)`

These are booking proceeds **before Stripe processing fees**, separate from
actual payout/bank balances. Monthly grouping remains based on the original
payment date; this is not a new cash-flow or tax reporting system.

Examples with a synthetic $115 charge, $100 parking and $15 platform fee:

| Customer refunds | Platform fee returned | Remaining proceeds |
| --- | --- | --- |
| $23 successful | $3 | $80 |
| $23 successful | $0 | $77 |
| $23 pending | $0 | $100, with pending-refund label |
| $23 failed/cancelled | $0 | $100 |
| $115 successful | $15 | $0 |
| $115 successful | $0 | -$15 retained-fee cost |

A retained fee is not silently clamped away after a full refund. No actual fee,
refund amount, allocation policy, booking duration or payment record is changed.

## Implementation

- Unrefunded base bookings retain their validated stored checkout split.
  Refund-marked bookings and all extensions use read-only Stripe lookups.
- Charge/PaymentIntent and refund reads use the stored connected account.
  Application-fee retrieval uses the platform account. Charge, PaymentIntent,
  fee/account, original amount, CAD currency and live/test consistency are
  checked before using the figures.
- Read all refund pages and count only succeeded Refund objects, deduplicated
  by ID. Pending/requires_action amounts receive a separate label; failed or
  cancelled Refund objects do not reduce proceeds. Conflicting/incomplete
  snapshots require review rather than a guessed amount.
- Use the current ApplicationFee amount_refunded. No pro-rata assumption and
  no reliance on the legacy one-refund field as a cumulative ledger.
- Missing identities, mismatched records, disputes or provider errors retain
  the transaction with net=NULL/under-review state. Known totals exclude those
  unknown amounts and are labelled accordingly.
- Four concurrent reconciliations share a 15-second provider-work budget;
  individual reads have at most a 5-second timeout and no automatic retries.
  Rows not verified in time remain under review, rather than timing out the
  whole history. Large-history performance must be measured on QA.
- Host summary and transaction rows use the same signed-cent contribution
  helper, including negative retained-fee costs. Partial-refund labels remain
  visible beside the remaining amount.
- Incorporates PR #164's payout-history resilience pattern: a failed payout
  lookup does not erase recorded transactions or claim "No payouts yet".
  Required booking/extension query errors still fail explicitly; only a truly
  absent legacy extension table is optional.
- Transaction descriptions also respect the existing paid-location policy:
  refunded/unentitled Driver history does not expose an exact address/title.
  Owning Hosts retain their own listing details.

## Validation

Synthetic tests execute pure calculations, authenticated handlers using the
installed Supabase client, mocked Stripe reads and actual transaction JSX
rendered to static markup. Every provider request is intercepted; mutation
methods are forbidden in the handler fixtures.

The 13 new API cases fail 11/13 against the unpatched #185 source; all pass
with the repair. Further cases cover fee-return variants, zero fees, full and
multiple refunds, duplicate IDs, pagination, pending/failed states, base versus
extension charges, account/charge/currency/mode mismatches, time budgets,
provider errors, review copy, negative amounts, ownership and cents rounding.

Native regression/build and the existing complete-schema rehearsal are
required on the final draft SHA. No real Stripe test-mode exercise, bank
settlement verification or customer financial reconciliation was performed.

## Remaining release gates

1. Coordinate with the full PR #185 privacy/SQL release; extension audit
   columns from its existing proposal are required. No standalone deployment
   to the old active QA schema.
2. Verify read permissions for connected Charges/Refunds and platform
   ApplicationFee objects on real Stripe TEST accounts. Missing permissions
   must show review, not fabricated earnings or a zero balance.
3. BetterQA should repeat the table above, then multiple partial refunds,
   repeat/reordered webhook delivery, pending-to-success/failure transitions,
   separately refunded extensions, fee refunds and a payout API outage.
4. Compare Host monthly/all-time cards, Recent Transactions and the earned
   Transactions tab; verify visible history, signed remaining amounts and
   correct status labels on desktop/mobile.
5. Test large refund/extension histories, pagination and timeouts. Unrefunded
   base rows without any refund marker still use stored checkout data until
   a webhook/refund marker arrives; this read model is not a replacement for
   durable Stripe reconciliation.
6. Existing webhook handling still flags a second distinct stored refund ID
   for manual reconciliation. This draft can read cumulative current refunds
   for reporting but does not repair that independent persistence limitation.
   Multiple-refund webhook/ledger policy remains an integration gate.
7. Preserve payment, refund and booking records. Keep BUG-005188 open until
   coordinated QA deployment and BetterQA payment/accounting sign-off.

**No hosted database changes, Stripe charges/refunds/replays, live customer
data repair, production merge or active QA promotion.**

Primary references checked:
- [Stripe direct-charge account scoping](https://docs.stripe.com/connect/direct-charges)
- [Stripe Charge object](https://docs.stripe.com/api/charges/object)
- [Stripe Refund list/pagination](https://docs.stripe.com/api/refunds/list)
- [Stripe ApplicationFee object](https://docs.stripe.com/api/application_fees/object)
- [Stripe ApplicationFee retrieval](https://docs.stripe.com/api/application_fees/retrieve)
