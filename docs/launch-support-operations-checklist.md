# ParkShare — Customer Support & Launch Operations Checklist
_Proposed pre-launch procedure; October 2026. Internal owners, inbox operation, legal policy and response targets require confirmation. This document contains no credentials or live customer data._

## Launch blockers to verify

- [ ] Confirm `info@myparkshare.ca` receives **inbound** messages and is checked by a named support owner; decide whether `support@myparkshare.ca` remains an active alias/forwarder. Changing code does not create an email mailbox.
- [ ] Confirm the sender domain is verified in Resend, and booking emails and support-form notifications reach both a test inbox and the actual intended ParkShare inbox. Never publish API keys or service-role secrets.
- [ ] Submit a **test** Contact Us ticket for each supported category. Confirm the message arrives with the category, optional reference and escaped customer text, and that replying goes to the customer's address.
- [ ] Test invalid contact forms, temporary delivery failures, successful acknowledgments and the direct-mail fallback.
- [ ] Verify a Driver's paid reservation, Host notification, booking email, and Stripe application fee/Host charge match. Test only in an agreed QA/test environment.
- [ ] Document the on-call support owner, backup contact and escalation route before accepting public bookings.
- [ ] Have qualified legal and insurance advisers review the Host requirements, limitations, cancellation/refund terms and privacy policy for the initial launch geography.

## Daily support workflow

1. Open the monitored support inbox; triage new messages by urgency and whether a booking is in progress.
2. For booking complaints, record the ParkShare booking reference and verify the transaction in the authorized admin/Stripe systems before taking action. Do not ask for card numbers, passwords, JWTs, Stripe keys or government ID by email.
3. Check whether the Driver and Host need a time-sensitive reply. Use in-platform Host/Driver messaging where appropriate; avoid exposing personal details to the wrong party.
4. For any possible payment/booking inconsistency, reconcile Stripe's connected-account payment with the ParkShare booking record *before* attempting a refund or manual correction.
5. Record case outcome, correspondence, and any unresolved follow-up in a controlled support log. Limit access to authorized operators; do not commit customer information to GitHub.
6. Review failed checkouts, undelivered emails and recurring errors at the end of each operating day.

## Incident playbooks

| Situation | First response | Verification and escalation |
| --- | --- | --- |
| Driver arrives; listed spot occupied or inaccessible | Acknowledge urgently; ask Driver not to park without authorization; offer an alternate available listing if feasible | Check time window and listing details; contact Host; assess refund under published policy |
| Host reports Driver in wrong bay or overstaying | Advise safe, nonconfrontational communication; verify booking and exact spot | Review platform messages and booking times; escalate safety concerns to appropriate local services if necessary |
| Customer says charged but no booking appears | Do not immediately re-charge or create a duplicate booking | Match Stripe session, payment intent, connected account, webhook deliveries, holds, booking row and notification status; escalate engineering if inconsistent |
| Customer requests cancellation/refund | Explain the policy shown when booking was made; do not promise an unverified amount | Check status, timing, payment and prior refund history before authorized action |
| Duplicate payment or failed refund | Acknowledge without promising outcome until reconciled | Investigate Stripe payment/refund identifiers and idempotency; avoid issuing a second refund blindly |
| Privacy / account deletion request | Confirm receipt, preserve privacy and use approved identity verification | Escalate to the designated privacy owner; follow retention and legal obligations |
| Suspected fraud, threats or safety emergency | Prioritize immediate safety; instruct users to contact emergency services where appropriate | Restrict access, escalate promptly and preserve relevant authorized records |

## Customer response templates and detailed procedures

Use [Support and incident procedures](support-incident-procedures.md) for the current
payment discrepancy, occupied-space, failed-extension and refund workflows,
customer replies, verification requirements, handoff and closure criteria.
The companion replaces the earlier short response examples in this checklist.
It also contains discussion exercises that can proceed during the QA outage;
these do not certify live payment, email or application behavior.

Before activating support:

- [ ] Confirm the primary support owner and backup.
- [ ] Confirm staffed coverage, holidays and the after-hours route.
- [ ] Confirm the payment approver, execution permissions and refund limits.
- [ ] Confirm engineering and safety escalation contacts.
- [ ] Agree the proposed internal response targets after staffing is confirmed;
      do not publish them as a guaranteed service level.

## Release and escalation checklist

- [ ] BetterQA has completed the requested regression tests and documented the outcomes.
- [ ] GitHub CI and Vercel previews are passing for the **combined** proposed release commit, not just individual fixes.
- [ ] QA release and production projects, databases, Stripe modes and email destinations have been positively identified.
- [ ] Database migrations (if any) have been reviewed, scheduled and verified with a rollback/recovery plan.
- [ ] No QA change or migration is applied while BetterQA is testing without a coordinated window.
- [ ] The team has reviewed the production deploy/rollback decision, and the support owner can monitor live bookings, payment webhooks and inbound tickets after release.

> Note: This is an operating draft, not an insurance promise, legal opinion, guaranteed support SLA, or authorization for refunds, account changes or deployment.
