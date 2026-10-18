# BetterQA BUG-005138 — past Host availability exceptions
**October 18, 2026 — application correction and OPTIONAL SQL proposal, not deployed**

## Root cause (verified in QA base branch)
- Host listing Step 6 rendered **From** and **To** exception inputs with no minimum calendar date.
- The To field could also precede From; the UI showed neither an inline error nor an invalid state.
- Step 6's Continue, Step 8's preview/publish checklist, and `publish()` checked whether *any* weekly availability existed but did **not** check whether the special-date ranges were in the past.
- New exception defaults used local `Date.setDate()` followed by `toISOString().slice(0,10)`, which can shift the date when the Host/browser timezone differs from UTC (particularly near midnight).

## Prepared repair
1. Pure helpers in `src/lib/availabilityExceptionDates.js` calculate **today in the configured schedule IANA timezone**, using `Intl.DateTimeFormat().formatToParts()`, without assuming the Host's browser clock zone or UTC date matches the property.
2. Strict Gregorian YYYY-MM-DD validation rejects invalid/empty or impossible dates, including non-leap February 29. A valid From/To range starts **today or later** and ends **on/after** From. Both available and unavailable exception types are covered.
3. **Add exception** defaults to tomorrow in the configured schedule's calendar (including leap-day/year rollover). A malformed timezone fails closed rather than silently reverting to UTC.
4. From/To inputs use native `min` to guide selection. The To minimum is the later of today and the selected From date. Invalid values show an accessible inline alert and disable **Continue**.
5. Preview lists an invalid exception as a blocking issue linking back to Step 6, while the final `publish()` **rechecks the current date immediately before uploading photos or inserting into Supabase**. An overnight-open tab therefore cannot publish yesterday's special date even if Step 6 looked valid earlier.
6. Invalid/cleared calendar-input changes are ignored instead of accidentally removing an exception from React state when `normalizeAvailability()` filters non-ISO dates.
7. Weekly recurring day/time schedules are **not** treated as past dates. Existing published availability and paid bookings are never changed.

## Read-only active data scan (no identifiers retrieved)
- QA: **14 listings**, **1** listing with one or more special-date exceptions.
- Production: **13 listings**, **0** listings with special-date exceptions.
- This is a presence count, not a confirmation that the one QA exception is expired. Do not delete or rewrite any historical exception records without the Host's approval.

## Timezone release dependency (important)
- The current base branch initially seeds listing availability timezone from **the browser**, which can be wrong when a Canadian Host is travelling.
- This isolated repair respects the schedule's currently configured IANA timezone; **it does not independently establish that timezone is the driveway's true timezone**.
- Combine and test with draft **BUG-005156 / PR #159**, which supplies the property-local timezone and requires verified listing backfill. Do not state that geographic timezone accuracy is solved by PR #171 alone.

## Optional database enforcement — explicit separate approval
- `docs/sql-proposals/bug-005138-future-exceptions.sql` is a **review-only** proposed BEFORE INSERT / UPDATE OF availability trigger.
- Because browser-side validation can be bypassed through the Supabase Data API, the trigger would check JSONB exception dates and configured IANA timezone on newly saved or genuinely modified availability.
- An old row's *unmodified* availability will not block changes to an unrelated field (price, images, etc.); an explicit availability edit containing expired exception dates must be cleaned up or discussed before save.
- The SQL proposal is tested only in disposable CI PostgreSQL, **not executed** on QA or production. It depends on trustworthy property-local timezone resolution from PR #159 and independent migration/rollback approval.
- No extra DB columns or cleanup jobs have been introduced in this PR.

## BetterQA acceptance tests
1. On Host listing Step 6, attempt Yesterday for From or To. Confirm dates are disabled by the picker where supported and otherwise show an inline error; Next and Publish stay blocked.
2. Set From tomorrow and To today; verify the To field cannot precede From and the range is rejected.
3. Set From/To today, tomorrow, multi-day future ranges, and dates spanning New Year's Day; confirm they succeed.
4. Test February 29 in leap and non-leap years and malformed date inputs.
5. Set custom special hours, available all day, and unavailable exceptions; the same date validation applies to all.
6. Leave the form open across local midnight: final publish must recheck today's date and reject any expired special date before any photo upload/DB write.
7. A Host viewing the site from **Europe/Athens** for a Canadian property: verify configured timezone and compare property-local Today vs browser Today. Complete PR #159 integration before declaring geographic correctness.
8. Confirm regular weekly schedules are unaffected and historical published listings/confirmed bookings are preserved.
9. In a disposable approved DB, direct INSERT/UPDATE availability with past exceptions fails; price/other unrelated edits on historical rows remain possible.
10. Retest mobile, desktop, browser date-picker differences and screen-reader error announcements.

## Boundary / release
- Keep as **DRAFT**. No merge to main, no production/active BetterQA QA changes, no Supabase schema migration, no existing availability edits, no live Stripe actions.
- Run unit, disposable PostgreSQL, GitHub Actions CI, Vercel preview and BetterQA browser checks.
- Coordinate an isolated preview integration with **PR #159** for property-local timezone data and **PRs #147/#154** for fail-closed Driver availability.
- Do not mark BUG-005138 fully resolved until BetterQA approves timezone linkage and tests real browser date entry.

