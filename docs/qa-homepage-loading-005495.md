# BUG-005495 — defer the account password estimator

Recovery QA and Stripe TEST only. No provider setting, database migration,
financial operation, new dependency or production release is included.

The homepage's initial JavaScript graph imported `authForm.js`, which imported
the roughly 800 KB local zxcvbn password dictionary. The recovery helper also
imported that module, so merely separating the account form's import would
have left the dictionary in the initial graph.

The lightweight account helpers now live in `authFormBasics.js`. The original
new-password and form validators remain together in `authForm.js`, with the same
12-character minimum, score threshold, 100-character scoring bound, full-secret
handling and existing-password sign-in behavior. `authValidation.js` loads that
module on demand, coalesces concurrent requests and fails closed before success.
It retains no credentials and does not send passwords to a scoring service.

All three account entry points (primary dialog, message email and extension email)
use the same DeferredAuth gate. Until the module succeeds, no account form mounts;
a named native modal provides loading status, Close/Escape and a generic failure
with explicit Retry. Late completions after cleanup or StrictMode replay do not
mount an obsolete form. A failed module load never bypasses strength validation.
The original modal's handlers, locks, screen resets and recovery bindings are
unchanged. The existing App recovery harness still exercises the loaded child;
the new tests separately exercise the real loading boundary and validator cache.

Recovery writes also await the validator and then recheck the attempt's ownership
before any session read. The existing verified-token/account checks and single
password-write request remain intact. A recovery retired during module loading
does not proceed to Auth. A failed dynamic import returns generic retry guidance.

## Measured scope

The local Vite build reports the initial JavaScript reduced from approximately
1.87 MB / 672 KB gzip to 1.05 MB / 280 KB gzip, about 58% less compressed initial
JavaScript. A separate approximately 820 KB / 393 KB gzip account-validation chunk
loads when an account dialog opens. Those bytes have been deferred, not removed
from the account workflow. Exact deployed sizes vary with build configuration.

The actual Vite output graph regression ensures zxcvbn exists in a dynamic chunk,
is absent from the initial static-import graph and HTML preload links, and initial
JavaScript stays below 1.2 MB raw / 330 KB gzip. Running the prior source through
the same build analysis reproduces the dictionary in the initial graph and
approximately 1.87 MB initial JavaScript.

The readable public HTML from BUG-005501 is retained. Metadata, structured data,
security headers, branding and routes are retained. Maps and other app features
still contribute to the entry bundle. This change does not by itself prove the
reported 6.164-second LCP is below 2.5 seconds. Do not mark the performance target
Passed without the browser measurement below.

## Verification and BetterQA retest

Automated coverage includes the real build graph and size budget; deferred-load
coalescing, failure and retry; fail-closed scoring; actual modal loading/error/
ready/Close behavior; unmount and StrictMode retirement; and recovery invalidated
during loading. Existing sign-in, signup, recovery, email and extension-dialog
regressions continue to exercise their original handlers with synthetic services.

On the deployed recovery commit:

1. Cold-load `/` on the ticket's 412×915 mobile viewport, Slow 4G and 4× CPU
   slowdown, cache disabled. Repeat three times and retain the traces. Compare
   median LCP against the previous recovery build under identical conditions.
   The acceptance target remains LCP at or below approximately 2.5 seconds.
2. Confirm the account-validation chunk is neither requested nor preloaded on an
   ordinary homepage/browse visit. Confirm readable content appears while the
   initial app is still downloading and no duplicate public document remains
   after the React commit.
3. Open Sign in/Join free with the validation chunk throttled, failed and then
   recovered. Verify named loading/failure dialogs, focus, Close/Escape and Retry;
   account fields appear only on success. An account form must never submit while
   validation is unavailable. Reopening should reuse the downloaded module.
4. Retest normal sign-in (including existing shorter passwords), weak/strong new
   passwords, signup role/consent, reset links, switching accounts during recovery,
   closing/reopening during loading, and message/extension email links. Preserve
   the intended booking context; no stale attempt may publish another account.
5. Recheck public routes, Maps, checkout and all readiness gates in Stripe TEST.

Local Chromium cannot launch under the environment's Unix-socket restriction;
the cloud browser entry point also failed before opening a page. Automated build,
HTTP and synthetic account checks are not a browser performance or live-auth pass.
Keep Ready for QA pending BetterQA's LCP and account-flow acceptance. If the LCP
target is still missed, retain the trace and continue route-level splitting with
that measured bottleneck rather than claiming the target from bundle sizes.
