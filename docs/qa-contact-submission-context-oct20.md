# Support and event submission request ownership — 20 October 2026

## Confirmed defect and repair

Code-identified defect; no assigned BetterQA issue number. The support form used React state alone to block duplicate submits, which leaves a window before rerender. The event form had no handler guard. Both could show success for an HTTP 200 without the endpoint's `ok: true` acknowledgement; event submission also invented a reference when none was returned. Late replies could write after unmount or event cancellation, and event fields could change while the submitted snapshot was pending.

Each form now owns a synchronous busy/completed lock inside a mount lifetime. It remains locked through response body parsing and after success. Cleanup invalidates old handlers and results; Cancel invalidates the event form immediately before closing. Changes are ignored while pending and event fieldsets/consent are disabled. A support success requires `ok: true`; an event success additionally requires a nonempty string reference. Invalid JSON, missing acknowledgement or missing reference produce uncertainty guidance instead of success. Server/network errors are caught and release the current form for explicit retry; there are no automatic retries.

The endpoint, email content/routing, event storage/review/publication, credentials, schema, grants and dependencies are unchanged. This prevents duplicate requests within the current form lifetime; it does not provide server idempotency across tabs, reloads or explicit retries. Closing a form cannot retract a request already sent. A lost reply may follow a successful send/save; check with Support before resubmitting an uncertain request. Endpoint acknowledgement does not prove delivery to a recipient's inbox.

## Automated verification

`test/qa-contact-submission-context.test.js` compiles the actual two JSX components with esbuild and controlled React hooks and fetch. It covers synchronous repeated handlers, pending response parsing, completed-handler replay, malformed acknowledgements/JSON/references, rejected fetch, server rejection and explicit retry, unmount during fetch/body parsing, pending field guards, StrictMode cleanup/setup, event Cancel, existing endpoint payloads, and support validation. Synthetic inputs only; no messages are sent and no event records are created.

Local validation: all 24 focused checks and all 891 tests pass; build and diff checks pass. The previous actual source fails 17 of the 24 checks. Run focused checks, `npm test`, `npm run build`, and `git diff --check`. Run the focused suite with `QA_CONTACT_SOURCE` pointing to the previous actual App.jsx to demonstrate failures of the previous implementation. Native CI and the disposable PostgreSQL full-schema rehearsal must pass on the exact candidate tree before QA deployment.

## BetterQA acceptance

1. On Contact, enter a valid support request and rapidly press Enter/click Send. Expect one request, disabled fields and Send while pending, then confirmed success. On a controlled server failure, expect a visible error and one explicit retry to work.
2. In Discover → Events → Submit event, fill a valid event and rapidly submit. Expect one request, locked fields/consent and a real returned reference on success. Confirm the event remains in review rather than publishing automatically.
3. Delay either endpoint response/body, navigate away or cancel the event form, then release it. Expect no stale success/error in a newly opened form. A submitted request may still finish server side; check whether it was accepted before retrying.
4. Intercept a response to return malformed JSON, `{}`, `null` or `ok: false` with HTTP 200; also omit/blank the event reference. Expect uncertainty guidance and no success confirmation. No automatic retry should occur.
5. Confirm normal support Reply-To and event review notification behavior using approved QA mailboxes. Actual inbox delivery and signed-in browser acceptance remain for BetterQA.

## Release verification scope

Deploy the tested branch only to the existing parkshare-qa Vercel project, keeping the earlier QA repair stack. Confirm the stable QA alias and exact release SHA, readiness flags, public page/API access and anonymous denial of private actions. Record native CI/deployment evidence in the PR. No valid live contact/event POST is used for deployment checks because it would send mail or create review records.

A proposed read-only comparison hashing private QA rows was rejected by automatic approval review. It was not retried or replaced with an indirect data read. Verification uses isolated tests/disposable CI databases and public QA/access checks; no live private-row comparison is claimed.
