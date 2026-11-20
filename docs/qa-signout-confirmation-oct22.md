# Sign-out confirmation and failure feedback — 22 October 2026

Code-identified defect; no BetterQA ticket number assigned. The shared App sign-out handler ignored Supabase's returned error, cleared the displayed account and private navigation, and routed to Browse even when the session remained active. A thrown error escaped the handler. Both regressions fail against the prior handler.

The repaired handler checks the current session before calling the existing SDK sign-out, catches returned/thrown failures, then verifies local session removal before clearing App state and routing. A pending notice and synchronous attempt lock prevent duplicate clicks. Failures with a retained session offer Retry sign out and Dismiss; unreadable sessions or account changes offer refresh guidance. If the SDK removes its local session but returns a global revocation error, the message explicitly distinguishes this browser from unconfirmed sign-out on other devices. Provider details and credentials are never shown.

Both desktop/mobile header actions and every shared public/private page use this handler. The notice has alert/status semantics, wrapping controls and 44px action targets. Account changes retire obsolete UI work; A→B→A does not revive a retired attempt, and App unmount prevents delayed state writes. A known foreign session is rejected before calling sign-out. A stored foreign session discovered afterward prevents stale UI clearing/navigation. A sent SDK call cannot be cancelled; this UI repair does not change the SDK's internal shared-storage behavior or guarantee revocation of already issued access tokens. The existing global scope remains unchanged; no manual token/storage removal, session restoration or retry occurs automatically.

No database migration, Auth setting, dependency, backend endpoint, email or financial change is needed. Stack on PR #236 and deploy only the isolated parkshare-qa project. Automated fixtures use synthetic sessions and intercepted SDK behavior, never real sign-ins, password changes or revocations. Real browser/Auth acceptance remains for BetterQA.

BetterQA retest with approved disposable Driver and Host accounts on desktop/mobile:

1. Normal Sign out: expect brief pending feedback, one request, signed-out header and Browse; refresh must stay signed out.
2. Use DevTools request blocking/offline to interrupt Auth session/logout traffic. The SDK may retain the session or remove it locally; expect matching error/uncertainty guidance, with no fabricated successful navigation. Restore connectivity and retry when offered, or sign in again before retrying if local removal occurred.
3. Double-click or queue the Sign out action: only one attempt should run. Retry after a failure should work; Dismiss should close the notice.
4. Switch accounts during a delayed request: old responses must not clear the replacement account's UI or navigate it away. Already-sent SDK side effects remain outside this UI guarantee. Test a fresh sign-out for the replacement account.
5. Recheck shared header actions from public pages, My Bookings, Profile, Host Dashboard and messages; normal sign-in/signup, Host onboarding and password recovery remain available.

Rollback: redeploy prior QA source `66a558dddbd78d603b9a08df63686c73cb10045f`. No data changes to undo.
