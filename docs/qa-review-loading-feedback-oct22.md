# Review summary loading and retry — 22 October 2026

Code-identified defect; no BetterQA ticket number assigned. The listing's Reviews section displayed “No reviews yet. Be the first!” and a zero count while its public review request was pending or failed. Failures were logged only to the console, with no recovery control. The existing API correctly returns 503 on a database read failure; this repair handles that failure in the UI.

Real listings now have separate loading, loaded and error states. Only a successful, validated empty summary array shows the genuine empty state and zero count. Pending/error reads hide unverified counts and averages. Errors show “Reviews are temporarily unavailable. Please try again.” and a 44px Retry reviews control; pending requests announce “Loading reviews…”. Retry performs one explicit GET, with browser caching disabled, never a review POST. The existing server/CDN cache policy remains unchanged.

Reads are scoped to the listing and reload revision. Navigation or a successful submission immediately hides the old summary while its replacement loads. Cleanup aborts the request and retires its context, so late success/failure, unmount, A→B→A listing navigation and cached retry callbacks cannot restore old content or error feedback. Malformed JSON/summary shapes, invalid ratings and provider errors receive the same safe error state without raw provider details. Duplicate retry clicks share the current read context.

Public reviews continue to use existing rating-only summaries. The endpoint, authorization, privacy projection, submission eligibility, content validation and demo-review behavior are preserved. No database migration, Auth change, dependency, new backend endpoint, data rewrite, account action, review insertion, email or financial action is needed. Automated verification uses synthetic responses; real browser acceptance remains for BetterQA.

BetterQA retest on desktop/mobile:

1. Open a real listing while throttling its `/api/public-reviews` request. Expect Loading reviews, with no false empty message or zero count.
2. Block/fail that GET. Expect the visible unavailable message and Retry reviews; no provider details or claim that there are no reviews.
3. Restore the request and click Retry reviews, including a double click. Expect one current read and the returned rating summaries. A genuinely empty successful array should show No reviews yet.
4. Switch listings during a slow request. The old success/error and old Retry control must not replace the selected listing's state. Repeat back-and-forth navigation and close the detail while a read is pending.
5. Submit a review using an approved eligible disposable Driver booking. Expect the existing save confirmation and a summary refresh with loading feedback. Recheck eligibility/duplicate-review protections and existing privacy behavior. A failed summary refresh must not submit the review again.

Deploy only parkshare-qa, stacked on PR #237. Rollback is prior QA source `564f4dd80e59a2f00a4ef28dfd2e7775864c6a90`; there is no data change to undo.
