# ParkShare Support and Incident Procedures

Use this playbook to handle payment discrepancies, occupied spaces, failed extensions and refund inquiries. Verify the customer, booking and payment state before promising an outcome. Each case has one owner and a recorded next update.

Version 1.0 | 25 October 2026 | For the ParkShare support team

### Launch support checklist

- Confirm that info@myparkshare.ca receives inbound mail and that the assigned team can reply. Verify or retire the support@myparkshare.ca alias before relying on it.
- Name the primary support owner, backup, payment approver and engineering escalation contact. Confirm access to the correct live or test systems.
- Set coverage hours, holiday handling and an after-hours route. Publish only the coverage the team can staff.
- Test Contact Us delivery and reply routing with synthetic data in an agreed environment. A successful send does not establish that someone reads the inbox.
- Rehearse the four incident procedures before launch. Keep an owner and next action on every unresolved case.

### Contacts and authority to complete

| Responsibility | Name or decision |
| --- | --- |
| Primary support and backup | To be confirmed |
| Coverage and after hours route | To be confirmed |
| Payment approver and refund limits | To be confirmed |
| Engineering and safety escalation | To be confirmed |

### Triage and response targets

Proposed internal targets during staffed coverage: acknowledge urgent arrival or active-session problems within 15 minutes and update every 30 minutes while unresolved. Acknowledge routine inquiries within one business day. Activate these targets only after staffing is confirmed; they are not a published service guarantee.

Treat a Driver unable to park now, an extension nearing its confirmed end, or a charge without a usable current booking as urgent. Escalate imminent danger to local emergency services immediately; support must not delay that action. Route suspected account compromise or a bank dispute to the responsible specialist.

## Common case handling

### Intake and verification

1. Create a case reference and record the receipt time, environment, customer contact, incident category and whether parking is in progress. Assign one owner and a next update time with its time zone.
2. Match the customer to their booking through the signed-in account or a verified account channel. A booking reference alone does not authorize disclosure or changes.
3. Record the booking, listing and bay references, requested action and relevant times. Use the property time zone for the parking window; retain the original timestamp and UTC offset. Escalate an uncertain historical start time.
4. Ask for the minimum missing evidence: amount and currency, transaction date, receipt reference, or a photo of the bay where safe. Redact unrelated statement entries, faces and plates.
5. Compare the live booking and payment records. Separate the original reservation from every extension charge and refund. Record the evidence checked, discrepancies and the next responsible person.

### Permission and communication rules

- Do not request passwords, login codes, API keys, full card numbers or security codes. Keep customer evidence in a restricted support system, not GitHub or public bug comments.
- Use the rules and terms applicable when the booking was made. The QA candidate can differ from production; candidate safeguards are not proof that a live incident is resolved.
- Only an authorized payment operator may execute a cancellation, refund, credit or financial correction within a recorded approval. Support must not manually create a paid booking or add hours from an email or screenshot.
- Before sending a template, replace every bracketed field, verify the recipient and select a realistic next update. Send only the applicable outcome text. Never describe a refund as received by the bank merely because it was submitted.
- If records are unavailable, acknowledge the case and escalate. Do not infer a failed payment, available bay or refund from a page error. A QA outage is not proof of a production outage.

### Handoff and closure

Record the case reference, impact, environment, booking and payment identifiers, verified timeline, current state, action already taken, approval, next action and owner. The receiving person must accept the handoff. Keep credentials and unrelated customer information out of the handoff.

Close only after the booking and all related charges/refunds reconcile and the customer receives the confirmed outcome. An awaiting-bank refund remains tracked until confirmed or handed to a named follow-up owner. Log the root cause or unresolved cause, bug reference if relevant, and any prevention action.

## Payment discrepancies

### Verify and act

1. Ask for the booking or receipt reference, payment date, amount and currency. Confirm whether the customer sees a pending entry or a posted charge; a screenshot is supporting evidence, not the payment record.
2. The authorized payment operator checks the correct Stripe mode and Host connected account, then matches the Checkout session, PaymentIntent, charge and booking. Identify each original and extension payment separately.
3. Check payment status, booking creation, webhook delivery and any refund or bank dispute. Two statement entries alone do not establish two settled charges.
4. If payment succeeded but the booking is missing or unusable, escalate to engineering and the payment approver. Preserve the references and timeline. Do not charge again, create a duplicate reservation or replay a financial action blindly.
5. For a verified duplicate, review which transaction should remain and whether either charge was already refunded or disputed. Execute only the authorized correction and reconcile the booking, receipt and ledger before closure.

### First response to the customer

Hi [Name],

We're reviewing the payment reported for booking [reference]. Please send the amount, currency and payment date if these were not included. Please avoid submitting another payment for this booking while we check. We do not need your full card number or security code.

We'll update you by [date, time and time zone].

ParkShare Support

### Confirmed booking outcome

Hi [Name],

We matched the [amount and currency] payment to booking [reference]. Your confirmed parking window is [start to end, property time zone] in bay [label]. We verified [brief explanation of the reported discrepancy].

[State any remaining action or verified correction.]

ParkShare Support

If the payment remains unmatched, use an interim update with the current verified facts and the next update time. For an authorized refund, use the refund confirmation on the [Refund inquiries section](#refund-inquiries) only after checking its actual status.

## Occupied or inaccessible spaces

### Protect the Driver and verify the reservation

1. Confirm whether the Driver is at the property and can wait safely. Ask them not to confront anyone, move a vehicle, block access or enter a different bay without authorization.
2. Verify the booking is confirmed for this property, bay and current property-local time. Check the access instructions and whether a bay-label or arrival-time misunderstanding explains the issue.
3. Contact the Host through the verified channel. Confirm availability and access; disclose only the information needed to resolve this booking. Record the contact attempt and response.
4. If the Host cannot resolve it promptly, escalate to the support backup. Suggest an alternative only after checking availability and the Driver agrees. Do not promise a replacement booking, reimbursement or towing.
5. Record whether the booked space could be used and when. Have the authorized owner review the applicable cancellation/refund terms and any exception. Preserve the original booking and financial history.

### First response to the Driver

Hi [Name],

I'm sorry you're having trouble accessing the space for booking [reference]. Please wait somewhere safe and do not confront another vehicle owner or use a different bay without confirmation.

Please confirm the bay label and your arrival time. We're checking the reservation and contacting the Host. We'll update you by [time and time zone].

ParkShare Support

### Message to the Host

Hi [Name],

The Driver for booking [reference] reports that bay [label] is [occupied or inaccessible] at [time and property time zone]. Can you confirm the correct bay and whether access can be restored by [time]?

Please reply through this verified channel with the steps the Driver should follow.

ParkShare Support

For the final Driver reply, state the verified access arrangement or that the booked space could not be provided. Explain the approved refund or other next step separately. Do not mark the incident resolved simply because the Host replied.

## Failed booking extensions

### Check time and money independently

1. Treat the case as urgent if the last confirmed session end is near. Confirm the original booking and its last verified end time; advise the Driver to plan around that time until added time is confirmed.
2. Match the extension Checkout session, connected account and charge to the parent booking. Check the extension application state, applied hours, resulting end time and temporary hold. A successful payment alone does not establish extra parking time.
3. Check whether payment is still pending, failed, applied, rejected or refunded. Keep the original booking status separate. Do not retry payment or manually add time while a charged extension is unresolved.
4. If the extension is paid but not applied, escalate to engineering and the payment approver. If it was rejected/refunded, verify the refund and the hold state before any later attempt. Removing a stale hold must not erase a genuine payment record.
5. Close only when the added time is verified or the financial outcome is reconciled and communicated. Use a fresh availability check before any new extension attempt.

### First response to the Driver

Hi [Name],

We're checking the extension request for booking [reference]. Until added time is confirmed, please plan to leave by your last confirmed end time of [time and property time zone]. A pending or refunded extension payment does not add parking time.

Please avoid another extension payment while we reconcile this request. We'll update you by [time and time zone].

ParkShare Support

### Verified extension outcome

Hi [Name],

We verified that [additional time] was applied once to booking [reference]. Your confirmed end time is now [date, time and property time zone]. The associated extension payment is [amount and currency], reference [receipt reference].

ParkShare Support

If the extension did not apply, explicitly say that the original end time remains in effect. Add the verified refund status using the [Refund inquiries section](#refund-inquiries). Do not say a refunded extension is available to use, or that a released hold guarantees space for a retry.

## Refund inquiries

### Review eligibility and the complete payment history

Check the terms shown at booking, the cancellation actor and timing, service availability, original payment, every extension, prior refunds and any dispute. In the inspected code, scheduled Driver cancellations with at least one hour of notice and Host cancellations before the start follow the ordinary automatic path. Book Now, started/late, partial-refund and extension cases need support review; do not turn that distinction into an automatic denial. Confirm behavior in the deployed environment.

| Verified state | Support action |
| --- | --- |
| Not requested or decision pending | Record the decision owner; do not say a refund was sent. |
| Pending or requires action | Payment owner investigates; track the existing request. |
| Succeeded | Confirm amount and reference; track any bank delay. |
| Failed or canceled | Escalate the cause and approved next action before retry. |
| Partial refund or open dispute | Review each charge and remaining amount; prevent duplicate reimbursement. |

### First response

Hi [Name],

We've received your refund inquiry for booking [reference]. We're reviewing the booking terms, the reason for your request and any refund already recorded. We'll confirm the decision and amount, or explain what still needs review, by [date, time and time zone].

ParkShare Support

### Verified refund confirmation

Hi [Name],

Stripe shows a refund of [amount and currency] submitted on [date] for [original booking or extension reference]. The refund reference is [reference]. [State whether this is a partial or full refund of that specific charge.] Your booking status is [verified status].

The refund returns to the original payment method. Card credits commonly appear in approximately 5-10 business days after release, depending on the bank; this is an estimate. We'll help trace it if it does not appear.

ParkShare Support

Use that confirmation only for the verified succeeded state. Pending/failed requests need an accurate status update and next action instead. A reversal may remove the original charge; an available bank tracing reference can help locate a credit. Check overdue refunds rather than issuing a second one.

## Launch verification and operating record

### Complete before activating support

- Fill the four responsibility fields on the [contacts table](#contacts-and-authority-to-complete) and confirm that the primary and backup can access the inbox and restricted case log.
- Confirm refund approval limits, who may execute financial actions and how exceptions are recorded. Do not create a new compensation entitlement through a template.
- Confirm coverage, the after-hours message and the proposed response targets. Define how an urgent case reaches the backup if the first owner is unavailable.
- Review the applicable customer terms and template wording together. Test the contact path and notifications in the agreed QA window after service recovers.
- Keep QA test data and production cases separate. Capture engineering defects without customer identities, card details or private access instructions in public BugBoard/GitHub records.

### Tabletop scenarios that can be completed during the outage

| Scenario | Expected result |
| --- | --- |
| Charge without a booking | One owner; matched payment evidence; no duplicate charge or manual paid booking. |
| Occupied bay and no Host reply | Safe Driver instruction; backup escalation; alternative or refund review without an unsupported promise. |
| Extension charged but not applied | Last confirmed end remains authoritative; original and extension reconciled separately. |
| Partial refund then another inquiry | All refund amounts reviewed; no duplicate reimbursement or false cancellation. |
| Pending refund and bank dispute | Escalate to the payment owner; no routine second refund. |
| Database cannot be reached | Acknowledge uncertainty and assign follow-up; no invented payment or availability outcome. |

### Record the exercise and handoff

For each scenario, record date, participants, assigned owner, proposed response, expected approval and any gap. Keep status Open until the gap has an owner and resolution. These are discussion exercises, not evidence that live email, payments or QA retests passed.

### Operating references

ParkShare code reviewed at QA preparation commit 34aa227 and production baseline 8c80fea: contact routing, cancellation policy, cancellation endpoint and customer terms. Confirm the deployed version when handling a real case. The mailbox and support staffing still require operational verification.

- [ParkShare cancellation policy source](https://github.com/brianbecker1929-cyber/ParkShare/blob/34aa227eded960cb44ad41bb8b8473c2ec1f7865/api/_cancellation-policy.js)
- [ParkShare contact routing source](https://github.com/brianbecker1929-cyber/ParkShare/blob/34aa227eded960cb44ad41bb8b8473c2ec1f7865/api/contact.js)
- [Stripe refunds and tracing guidance](https://docs.stripe.com/refunds)

## Additional customer status responses

Use these messages after verifying the stated facts. Fill all placeholders and give a realistic next update. The named payment approver must approve a financial action before it is described as authorized.

### Payment still being reconciled

Hi [Name],

We have not yet matched the reported payment for booking [reference] to a confirmed outcome. So far, we have verified [facts]. Please avoid another payment for this booking while we investigate. We'll update you by [date, time and time zone].

ParkShare Support

### Booked space could not be provided

Hi [Name],

We confirmed that the booked bay [label] could not be provided for [booking reference and time]. [State the verified alternative accepted by the Driver, or that no alternative has been arranged.] We're reviewing the payment outcome under the booking terms and will confirm the next step by [date, time and time zone].

ParkShare Support

### Extension was not applied

Hi [Name],

We confirmed that the additional time requested for booking [reference] was not applied. The original confirmed end time remains [date, time and property time zone]. The extension payment currently shows [verified payment or refund status]. [State the verified next action.] We'll update you by [date, time and time zone].

ParkShare Support

### Refund remains pending

Hi [Name],

The [amount and currency] refund for [charge or booking reference] is still pending as of [date and time]. It has not been confirmed completed. We're checking the existing request and will update you by [date, time and time zone].

ParkShare Support

### Refund requires further action

Hi [Name],

The refund for [charge or booking reference] has not completed. We verified [failed or canceled status and relevant explanation]. We're reviewing the next authorized step and will update you by [date, time and time zone]. Please do not send new card or bank details in this email thread.

ParkShare Support
