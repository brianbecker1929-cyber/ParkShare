# BUG-005158 — October 29 recovery investigation

BetterQA reports a checkout.session.completed HTTP 500 after a 200 and a pending
Stripe retry. Keep the ticket open until the exact event/destination is correlated.

## Evidence
The Stripe TEST platform has three enabled destinations: the fixed recovery URL,
old parkshare-qa.vercel.app, and www.myparkshare.ca. No endpoint was changed.
The older QA destination used the unavailable original QA Supabase project and
logged checkout failures with HTTP 521 database HTML at 08:40 and 09:21 UTC,
while the matching new recovery bookings PK-62/63 succeeded. A 200 for one
destination does not establish success for another destination.

Recovery itself also has genuine failures: checkout.session.completed at
14:50:59.750 UTC and several refund.created/refund.updated calls logged
the exact statusless message "upstream request timeout". The reviewed evidence
does not establish a 500 on every current recovery payment. Recent bookings
through PK-82 are present; do not infer a duplicate charge merely from retries.

## Narrow hardening and tracing
The read-only retry classifier now recognizes the exact statusless transport
message, with the existing bound of two attempts. Explicit SQL, FK, permission,
missing-row and integrity error codes still fail closed. This does not retry
Stripe writes, booking/extension mutations, settlement RPCs or refund creation.
A timeout in a write path still returns HTTP 500 for Stripe redelivery.

The handler now logs processed/failed correlation using only event ID/type,
object ID, connected account ID, test/live flag and deployment/branch identifiers.
It does not log event payloads, names, addresses, email addresses or credentials.
Existing signature verification, registered-payment integrity and idempotency
rules remain unchanged. No fake success response or synthetic settlement is added.

## Next BetterQA evidence
Attach the exact evt_ ID, failed destination/endpoint URL, first-success and
failure attempt timestamps/timezone, and response body. Specify whether 200 and
500 belong to the same endpoint. For a fresh normal-card and 3DS test, confirm
one booking and the required emails, then inspect recovery destination deliveries.
Use genuine Stripe retries for verification; no event fabrication/replay/refund/
manual booking insertion or paid-hold cleanup was performed.

This change remains QA-only on recovery branch qa/recovery-preflight-oct27,
draft PR 252. Original Bremner evidence, scheduler and production remain unchanged.
