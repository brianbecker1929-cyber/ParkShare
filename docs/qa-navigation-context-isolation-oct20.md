# QA follow-up: navigation chooser account and destination isolation

Code-identified navigation UI privacy/correctness defects; no new BetterQA ticket ID. QA only, stacked on PR #202 and all prior repairs. No main merge or actual production promotion.

## Defect and repair

The global navigation request retained its listing object through sign-out/account changes, leaving a previous account's private title/address visible in the chooser. Old Navigate callbacks could also launch the previous account's destination directly through the saved provider; old chooser callbacks could open or dismiss a replacement destination and change the saved preference. Provider buttons could open more than one map before React committed dismissal. The request held the entire mutable listing/booking object, including unnecessary private fields.

A root navigation hook now scopes each request/callback to its current identity and request lifetime. On identity change, it adjusts its own state before committing children, clearing both private destinations and anonymous previews. A to B to A cannot restore an old request. Replacing, choosing, dismissing or clearing eagerly invalidates old callbacks before another render. The chooser key follows a request revision, including replacements with the same listing ID. A destination is a captured copy of only id/title/address/lat/lng; later source-object mutation cannot change the selected destination, and photos/vehicle data are not retained.

Current-account Navigate still opens an available saved provider synchronously. Public preview always offers a chooser; unsupported saved providers fall back to it. Only currently available providers can be selected or saved. The browser-wide provider preference is intentionally retained across identities and contains no destination. The once-registered browser Back/Forward listener uses a stable global clear of the latest request, rather than capturing an initial request-bound closer.

Backend address authorization, data projections and navigation URL builders are unchanged. This scopes the app's known identity and rendered request; it does not add session/network revalidation, revoke already-disclosed locations or close/recall an external map already opened. Browser popup behavior is unchanged. Independent rideshare/geolocation and edit/delete/cancel request helpers remain outside this repair. No migration or dependency change.

## Verification

`test/qa-navigation-context-isolation.test.js` executes the actual new root hook (and actual previous root state/callbacks for old-source reproduction), renders the actual chooser, compiles its root key/props and executes the actual browser history listener. Eighteen checks cover visible private addresses on identity changes, sign-out/anonymous sign-in, A/B/A, stale saved-provider/direct/choose/close callbacks, two choices before a render, close/history invalidation, minimal destination copies, public previews, Waze address+coordinate URLs, unsupported provider fallback, supported Apple Maps, same-account refresh, retained browser preference, invalid/no request and same-ID replacements.

Five primary checks fail on previous source 130b711f805b5acc33a33000146900fc1e34b65f: private request persists after account switch, stale saved-provider launch, old chooser action affects its replacement, duplicate map opens and provider selection after dismissal. All focused checks pass with the repair. Tests inject synthetic destinations, preference stores and window-open spies: no private address is actually sent to a map provider and no account is logged in.

Run full native CI/build and PostgreSQL 17 full-schema rehearsal on the exact release commit before QA deployment.

## BetterQA acceptance

1. With authorized QA accounts, open Navigate/Change app from a confirmed booking with a private address. Sign out or switch accounts (including another tab). The chooser must disappear immediately when the app's identity changes; old address/title/provider callbacks must not remain. Include A to B to A. An already-open external map cannot be recalled by this repair.
2. Open a destination, then close/replace it with another, including the same listing ID with refreshed data. Trigger a delayed/queued old provider selection or close: it must not open the old location, change preference or dismiss the new chooser. Rapid provider clicks before dismissal must open one map for that action.
3. Open the chooser, use browser Back/Forward and then a queued old provider click. The latest chooser must close and old selection must do nothing. Confirm fresh subsequent navigation still works.
4. Signed out, preview a public approximate location with/without a saved preference. It must still offer the chooser and use only its public destination. Signing in clears the old preview. Verify normal current-account saved Waze/Google behavior, Change app, supported Apple Maps and unavailable-provider fallback; the browser preference should persist.
5. Confirm destination titles/addresses match the clicked listing, Waze's address and coordinate pin remain correct, private My Bookings access remains protected, and desktop/mobile chooser controls/keyboard dismissal and popup behavior remain normal.

Signed-in browser/map-provider acceptance remains BetterQA's responsibility. Synthetic callbacks are not evidence of a historical backend disclosure or an external map launch.

## Release and rollback

Deploy exact tested SHA only to QA project prj_HKX5OcxoBCUDEwqeDNsPD2vh87wC at https://parkshare-qa.vercel.app . Require exact-SHA/all-flag readiness, public/booking pages and signed-out private address/booking/photo/message/transaction denials. Verification performs no login, external map launch, database write/migration, booking/payment/refund/hold, listing/Storage or message/email action. Compare before/after read-only counts and booking/listing fingerprints; preserve concurrent tester activity. Confirm actual production unchanged and put final evidence in the PR body.

QA rollback redeploys 130b711f805b5acc33a33000146900fc1e34b65f. It keeps previous backend and extension safeguards but restores these navigation UI defects.
