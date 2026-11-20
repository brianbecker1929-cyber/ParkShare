# Discover search ownership — 20 October 2026

## Confirmed defect and repair

Code-identified defect; no assigned BetterQA issue number. Discover did not retire asynchronous restaurant/event requests on mode, filter or component lifetime changes. In particular, an earlier Be Adventurous request could navigate to parking after the driver pressed Back, switched to Events, or changed the restaurant search. Old responses/errors/loading cleanup could overwrite a newer search. The disabled buttons alone did not block duplicate handlers before rerender.

Tie each request to an object identifying the current mode and restaurant/event filters. Commit changes and unmount invalidate that lifetime using a layout effect; navigation and input handlers invalidate immediately before their parent/state update. A -> B -> A does not revive the original lifetime. Clear obsolete results, errors, busy indicators and event-submission modal on scope changes. Keep text/filter values when switching modes.

Use a synchronous per-lifetime lock across restaurant Search/Be Adventurous and through the entire event read. After Places library import, verify ownership before starting the provider search. Check ownership again before applying success/error/loading updates or navigating. Result-card actions require a current result object and invalidate navigation immediately, so queued obsolete or duplicate clicks cannot select a different destination. Current failures and empty searches remain retryable.

The existing Places query fields, maxResultCount 12, location bias, selected cuisine and event query's published status, ordering, six-hour start window and 100-row limit are preserved. Normal restaurant/event parking destination payloads retain coordinates and event schedule. No API, provider credentials, schema, grants, dependencies or payment changes.

Already-sent provider/database reads may still complete. This repair ignores obsolete results; it does not cancel the remote operation or guarantee zero provider billing. A changed filter retires the prior request and allows a fresh explicit search; it does not automatically search each keystroke.

## Automated verification

`test/qa-discover-search-context.test.js` compiles the actual Discover JSX, injects controlled hooks and providers, and uses actual restaurant/event helpers. All 19 checks pass. Running the same checks against the previous actual App.jsx fails 16 checks, including late adventure navigation, overwritten results, duplicate searches, obsolete card actions and post-unmount writes.

Coverage includes Back before parent navigation commits, restaurant query/cuisine changes, restaurant/event mode A -> B -> A, library-import gap, synchronous duplicate handlers, old success/failure during a newer pending search, filter A -> B -> A, old cards during/after replacement, normal filtered destination payloads, retryable empty/error/library states, unmount, StrictMode effect cleanup/setup, all event filters, bounded published-event reads, and duplicate event destination callbacks.

Local validation: all 910 tests, build and diff checks pass. Run the full `npm test` suite, `npm run build`, and `git diff --check`; native CI and the disposable full-schema rehearsal must pass on the exact tree before QA deployment. Providers and navigation are synthetic in regression tests: no live Maps search, database mutation, sign-in, email or payment is performed.

## BetterQA acceptance

1. In Discover → Restaurants, delay a Be Adventurous request, then press Back or switch to Events. Release the old response; expect no unexpected parking navigation or old error/result.
2. Start a restaurant search/adventure, change name/area or cuisine and search again. Release replies in either order; expect only the current query's results and busy state. Repeat A -> B -> A.
3. Rapidly press Enter/Search/Be Adventurous; expect one request for the active search. Click an old result while a replacement is starting; it must not select an obsolete destination.
4. Repeat with event name, category and date changes, mode changes and delayed successes/errors. Current results should retain the event's local schedule and correct parking destination.
5. Confirm normal restaurant Search, Be Adventurous, event Search and Find parking nearby. Confirm empty/error states allow an explicit retry and Add your event still opens/closes normally.
6. Leave Discover while loading, return and search again. Old responses must not alter the new screen. Desktop/mobile and real provider/browser acceptance remain for BetterQA.

## Release scope

Stack on PR #211 and deploy only the existing parkshare-qa project. Confirm exact release SHA/readiness, Discover route shells and static asset, public reads and anonymous access denial; inspect a scoped runtime log sample. Record final CI/deployment evidence in the PR. No live account, email, payment, data mutation or private-row comparison is part of release verification. Production stays on its existing deployment.
