# Message send confirmation — 20 October 2026

## Confirmed defect and repair

Code-identified defect; no assigned BetterQA issue number. The conversation controller treated any successful HTTP response as a sent message, even an empty/malformed body or an acknowledgement for a different conversation. MessagingPanel clears its input before sending and restores it only when the controller returns retryText. These unconfirmed successes could silently discard the submitted draft. A GET started before send could also finish later and clear the send warning. Network/5xx failures did not explain that an already-submitted message might have been saved.

Validate the saved-row response contract returned by api/messages.js: positive safe message/listing IDs, matching listing and booking context (explicit null for listing-only sends), matching sender and exact trimmed text, and a nonempty non-self recipient matching the selected participant when supplied. Accept canonical numeric ID strings as well as numbers. Do not claim success or refresh the thread from an invalid acknowledgement.

Retire/abort an older read when a send starts so its late result cannot clear the send outcome. Preserve the submitted draft through the existing retryText return, without overwriting a newer typed draft. For missing/mismatching 2xx acknowledgements, response-body failures, network errors and 5xx/408 replies, show: “We couldn't confirm whether your message was sent. Reopen the conversation to check before trying again.” Keep explicit 4xx rejection/account-change errors and existing duplicate-send locking. A confirmed send stays sent if only its follow-up refresh fails; do not offer the same draft as an unsent retry.

Validate the endpoint’s existing 4,000 UTF-16-unit text limit before POST. Longer drafts return intact with a clear instruction to shorten them; the client does not silently truncate. Boundary-length text remains supported.

No automatic replay. This is client response validation and draft handling, not server idempotency, remote cancellation, exactly-once delivery or a new authorization boundary. An uncertain or already-submitted POST may have created a message, including after Close; users should reopen/check the conversation before manually retrying. Read abort only retires a GET and does not unsend a POST. Existing backend authentication, participant checks and RLS remain authoritative. Existing cleanup suppresses obsolete UI callbacks.

No endpoint/admin privilege, schema/grant, credential, dependency, email-template, payment or other auth-flow change. The acknowledgement follows the existing API response and captured message schema; no new data read/projection is introduced. Inbox row keys and other messaging behavior are outside this repair.

## Verification

`test/qa-message-send-confirmation.test.js` runs the actual conversation controller plus actual compiled MessagingPanel with synthetic HTTP/session providers. All 19 new checks pass. Previous actual source fails 11 while eight preservation checks pass. Existing message-context fixtures are updated to use the real saved-message response shape, replacing incomplete id-only success mocks.

Coverage: matching acknowledgements/numeric string IDs, missing/foreign/malformed rows, listing-only recipients/null booking, invalid JSON/interrupted bodies, network/5xx/408 uncertainty, permission rejection, stale initial reads and pending session lookups, lock through acknowledgement and refresh, confirmed send with failed refresh, disposal while reading acknowledgement, account mismatch before POST, manual retry without auto-replay, actual composer draft restoration/newer draft preservation, and clearing only confirmed drafts. No real message, account, session or database row is changed.

Local validation: all 1,019 tests pass with zero failures/skips; focused 55 messaging checks and final 19-check regression suite pass. Build exits successfully and the built JS contains the new confirmation guidance; diff checks pass. Run native CI and captured PostgreSQL schema rehearsal on the exact tree before QA-only deployment. Then verify stable alias, deployed SHA/readiness, served JS and public/access HTTP checks. Record final evidence in the PR. Real two-account browser/messaging acceptance remains for BetterQA.

## BetterQA acceptance

1. Using approved Driver/Host QA accounts, send normal booking-specific and listing-only messages. Confirm correct conversation, sender/recipient, trimmed text, one request for repeated Enter/click, and ordinary thread refresh.
2. Simulate empty/malformed or wrong-context successful responses. The submitted draft should return unless newer text was typed, and the warning must ask the user to reopen/check before retrying. No automatic resend should occur.
3. Drop a response after POST or simulate 500/503/408. Reopen the conversation first: the server may already have saved the message. Manually retry only after checking. Confirm permission rejection and changed-session errors remain clear.
4. Delay an initial GET, then produce an uncertain send result and release the old GET. It must not clear the warning or replace history. Confirm a valid send followed by a failed refresh does not restore its already-sent draft.
5. Try 4,000-character and over-limit drafts, including emoji. Boundary text should send; over-limit text must stay intact with a clear length error and no POST.
6. Close/change accounts/conversations with pending responses. Old results must not populate another conversation. Retest normal message links from booking emails and preserving a newer typed draft while a send is pending.
