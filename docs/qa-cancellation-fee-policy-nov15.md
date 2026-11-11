# Cancellation reasons and refund processing fees — Nov 15 regression scope

QA-first implementation for BetterQA. Production rollout and the frozen build designation remain separate handoff steps.

## Entry points and authority

Host/Driver: Upcoming booking → Cancel booking → choose a reason. Driver free cancellation still requires a scheduled booking with at least one hour of notice; Hosts can cancel before the session starts. Late cancellations, Book Now sessions, earlier partial refunds, and paid extensions retain support review safeguards.

Host: **Manage refunds** in the signed-in app → enter the booking number → Review booking → a voluntary/goodwill partial refund. Amounts are CAD and apply to the original booking payment. A partial refund must be less than the remaining payment and leaves the booking active.

ParkShare staff: the same **Manage refunds** control also offers staff reasons, access problem reports, partial refunds, and cancellation/refund of the remaining original payment. Staff must record approval/verified findings. Staff access requires the trusted Supabase **app_metadata.parkshare_staff = true** boolean, administered by ParkShare. Profile role and editable user metadata never grant staff access. Every API request verifies the current user through Supabase Auth; UI visibility is not authorization. Provision a dedicated QA staff account before BetterQA tests these cases. Do not grant this flag to ordinary Host/Driver accounts.

## Exact reason codes

| Role | Code | Label | Original Stripe processing fee |
| --- | --- | --- | --- |
| Driver | driver_plans | Change of plans | ParkShare, when eligible for free cancellation |
| Driver | driver_wrong_time | Booked the wrong date or time | ParkShare, when eligible for free cancellation |
| Driver | driver_access | Problem with the parking space or access | Staff review; no automatic refund or assignment of fault |
| Driver | driver_other | Other | Existing eligibility; explanation required |
| Host | host_unavailable | Space unavailable | Host |
| Host | host_blocked | Driveway or access blocked | Host |
| Host | host_listing_error | Listing or schedule incorrect | Host |
| Host | host_emergency | Personal emergency | Host |
| Host | host_other | Other | Host; explanation required |
| Host partial refund | host_partial | Host voluntary or goodwill partial refund | Host; explanation required |
| Staff | staff_error | ParkShare booking or payment error | ParkShare |
| Staff | staff_goodwill | ParkShare-approved goodwill refund | ParkShare |
| Staff | staff_exception | Exceptional circumstances outside both parties’ control | ParkShare |
| Staff | staff_host_fault | Verified Host failure | Host |
| Staff | staff_driver_eligible | Verified eligible Driver cancellation | ParkShare; server rechecks Driver free-cancellation eligibility |

All staff reasons require an explanation. A Driver access report is recorded in `booking_cancellation_reviews` for staff to adjudicate. It does not cancel the booking or automatically reimburse anyone. Booking remains active and the Driver is prompted to contact support. Reports can be submitted once per booking/requester; repeated submissions do not create duplicate reports.

## Money movement and durable audit

The existing integration uses direct charges on connected Host accounts. Stripe normally retains the original processing fee on refund. Refunding ParkShare's application fee does **not** reimburse that Stripe fee.

Every refund is first reserved in service-only `booking_refund_operations`. Amount, authenticated actor, reason, fee payer, charge/account/mode, actual original Stripe fee and provider idempotency keys remain fixed for that request. Concurrent unfinished requests on the same booking are blocked. Full cancellations use a stable booking request key; partial refunds use an explicit request UUID retained across retries.

Refunds use the connected Host account and `refund_application_fee: true`: the Driver receives the eligible refunded payment, including the proportional ParkShare service fee. Customer refund settlement and booking/earnings state remain owned by the existing verified Stripe refund-history reconciler; this endpoint does not overwrite the financial ledger or claim a submitted refund has settled.

If ParkShare is responsible, a separate platform-to-Host Stripe Transfer reimburses the corresponding share of the **actual `stripe_fee` entries** on the original charge's balance transaction. Application, Connect, conversion and tax fees are excluded. CAD charge, balance transaction, payment identity, account, and mode must verify. No estimated processing percentage is used. The cumulative rounded reimbursement target is:

`round(original Stripe processing fee × cumulative ParkShare-responsible refunded cents / original payment cents)`

Subtract previously allocated credits on the charge. Never exceed the original processing fee. Host-responsible refunds allocate zero platform credit. Partial credits are issued only after the matching successful customer refund exists in the verified `payment_refunds` ledger.

The existing authenticated minute job `/api/send-refund-notifications` also drains refund operations. A two-minute database lease and fixed Stripe idempotency keys protect retries. An ambiguous provider result is not retried after Stripe's 24-hour idempotency window; the operation is flagged for staff reconciliation. Insufficient platform funds/provider failures leave the credit visibly pending. **A fee is not shown as transferred without a stored transfer ID.** ParkShare needs an available Stripe balance to fund reimbursements. The Host earnings total remains its existing before-Stripe-fees calculation; processing-fee credits are displayed separately in Manage refunds.

## Regression checklist

1. Each Driver/Host reason once; test Other without an explanation, invalid reason and forged fee payer.
2. Direct authenticated Host/Driver requests with each staff-only reason must return 403 and make no Stripe request. Editable user metadata must not grant staff authority.
3. Dedicated staff account: each staff reason; verify approval required and free-Driver reason cannot override the notice rule. Use staff goodwill/exception for approved late exceptions.
4. Full eligible cancellation: Driver refunded original payment including application fee; correct processing-fee responsibility; Host fee credit only where ParkShare pays.
5. Host voluntary and staff partial refunds: booking remains active, Driver refund/application-fee amounts reconcile, cumulative credits round correctly and stay capped at actual original fee.
6. Repeated clicks, concurrent calls, lost provider response, webhook-before-response and delayed webhook: one refund/credit per operation; no stale booking/ledger overwrite.
7. Driver access report: stays active and appears for staff review; selecting the reason alone never assigns Host fault.
8. Paid extension cancellation remains support-only; do not claim all charges were refunded by an original-payment-only endpoint.
9. Refund/fee-credit queue and existing refund notification emails both run on the protected minute schedule. Pending credits remain visible when platform balance is insufficient.
10. Test with Stripe TEST fixtures and a controlled inbox. BetterQA owns acceptance and the fresh QA payment used to verify the disabled production-domain TEST destination.

Migration: `20261111033631_cancellation_reason_fee_policy.sql`. Additive service-only tables and RPCs; no existing booking/charge rows are rewritten by migration. Production deployment/migration are not part of the QA implementation.
