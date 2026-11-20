# QA follow-up: messaging account and conversation isolation

Code-identified messaging privacy/correctness defects; no new BetterQA ticket ID assigned. QA only, stacked on PR #197 and the complete earlier repair stack. No main merge or actual production promotion.

## Defects and resulting behaviour

The inbox accepted late requests after account changes and retained old cards while the next load was pending. In a controlled reproduction, account A's late response replaced B's conversation preview/address. The global message panel also retained account-owned context, and unguarded conversation reads could overwrite a different thread. Send handlers could resume after session changes or start another POST while a send was pending.

Inbox and email context reads now verify the session owner and abort/invalidate stale work. The inbox clears its data/error/loading state on account changes. The global panel is associated with a fresh account scope for each identity transition; it hides immediately on a change, clears obsolete context, and rejects old callbacks, including A to B to A transitions. React keys reset the inbox, email booking context and conversation panel by the relevant account, booking and participant, clearing old history/drafts rather than reusing them for a new context.

A per-panel conversation controller captures immutable account/listing/booking/participant values. Reads use no-store, cancellation and a latest-request check. Sends recheck the original account before POST, prevent simultaneous submits synchronously, retain the original recipient context, and refresh only that same conversation. A failed old send cannot overwrite a newly typed draft. Closing a conversation invalidates future UI callbacks and any send still waiting for session lookup. Already-submitted POSTs may complete server-side; closing a panel is not a promise to unsend them. No automatic message replay or new persistence/idempotency mechanism is introduced.

A persisted `db-` listing always uses authenticated messaging. Signed-out users cannot send or receive simulated Host replies for real listings. Genuine demo listings retain local simulation, and their reply timers are cleared when closed. Email conversation links still only read/open the authorized context; they never automatically send a message.

Backend booking/participant authorization, RLS, message histories and all booking/payment protections remain unchanged. No migration or dependency change is required. Independent Host Dashboard/transaction/navigation/extension overlay state is outside this messaging repair.

## Verification

`test/qa-message-context-isolation.test.js` has 20 checks covering actual inbox/email effects, compiled panel JSX and submit handlers, React context keys, root account-scoped selection, and the real new conversation controller. Controlled promises test late success/error/body/session results, transports that ignore abort, overlapping reads, thread changes within the same listing, A/B/A account transitions, pending-send disposal, one POST for rapid submits, exact recipient/booking binding, explicit failure recovery and newer-draft preservation. All transports are injected synthetic fixtures; no real message is sent.

The two primary inbox tests fail against the prior committed App source (`bd66dc8005f98ede570a8719fc0eb3e933b68eab`): A's private preview is rendered after B loads, and old cards remain during the transition. All targeted checks pass with the repair. Run full native regressions/build and PostgreSQL 17 full-schema rehearsal on the exact release SHA before deployment. Native database messaging probes retain participant-pair, spoofing and unrelated-user protections.

## BetterQA acceptance

1. With two disposable accounts, delay inbox responses, replace the signed-in session (including cross-tab changes), and release old responses. Only the current account's conversation previews/names/listing titles may appear. Include sign-out and A to B to A.
2. Open a conversation and delay its messages. Change to another booking/participant in the same listing, or change account. Release the old response: history, draft and errors must belong only to the current context, and old panels must not reopen.
3. Type a message, submit repeatedly with Enter/click while the request is pending, and confirm one POST/one message for that pending action. Verify the correct recipient/booking. Type a new draft during a failed send; it must not be overwritten. Do not assume closing can reverse an already-submitted message.
4. While a send is waiting for session lookup, close the panel or change account: no new POST should start from the disposed context. Existing backend denials for unrelated users/participants must still hold.
5. Open confirmation-email message links while signed out, sign in with the intended QA account and verify the authorized conversation opens without sending. Switch email booking IDs quickly.
6. Signed-out real listings must require sign-in and never produce simulated Host replies. Confirm demo-only replies still behave locally and stop after the panel closes. Recheck ordinary inbox, read, send, privacy denials and previous booking fixes.

BetterQA must perform signed-in browser acceptance with authorized test accounts. Automated simulations are not evidence of a historical backend disclosure or of live message delivery.

## QA release and rollback

Deploy the exact native-tested commit to Vercel QA project `prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC`, https://parkshare-qa.vercel.app/parking . Require all readiness checks, public browse and signed-out denial on messaging inbox, conversation context and POST. The unauthenticated POST test must stop at authentication and create no message. Check QA message/booking/listing/extension/refund/Storage counts and full booking/listing digests before and after; verify actual production remains unchanged.

No Supabase migration, account login/creation, real message, email, booking, payment/refund or Storage operation is performed for this release verification. Existing rows are never backfilled or rewritten. Rollback is a QA redeployment of `bd66dc8005f98ede570a8719fc0eb3e933b68eab`, retaining all database protections and receipts; it restores the messaging context defect and should only be used after reviewing the regression impact.
