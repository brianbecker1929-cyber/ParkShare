# BetterQA BUG-005137 — Reject negative and invalid Host hourly prices

**October 18, 2026 — review-only draft. No active QA or production changes.**

## Verified root cause
- New listing pricing used `<input type="number" min="1" max="200">` but did not validate the constraint in application logic when advancing to preview. HTML `min`/`max` does not prevent manual submission without form validity checks.
- Host edit used `<input type="number" min="1">` but the save handler never validated; `saveListingEdit` used `Number(updated.price) || 1`, which preserves negative numbers, and sent them directly to Supabase.
- Publish used `price: Number(form.price) || 12`, silently replacing invalid zero/empty values with a default while allowing negative values to persist.
- `listings.price` in existing Supabase databases has **no CHECK constraint**. Stripe checkout code has a basic minimum, but did not check the stored rate is a valid Host hourly price before proceeding.

## Read-only data inventory
- ParkShare-QA: 14 listings, min $1, max $99, zero below $1 or above $200, zero fractional-cent rates.
- Production: 13 listings, min $1, max $900, **3 existing listings above $200**, zero fractional-cent rates. No prices were changed and the three listing identities were not extracted.
- Because real production prices exceed the form's current $200 suggestion, **no universal $200 database ceiling is proposed** without a separate product decision. Existing positive, whole-cent historical prices (including $900) remain editable without forced repricing.

## Proposed repair
1. `src/lib/listingPrice.js`: shared validation requires a finite hourly CAD rate of at least $1.00 with at most two decimal places. Empty, zero, negative, sub-dollar, malformed, exponent and sub-cent values fail.
2. Host creation: show validation feedback during pricing; preview/publish requires a valid rate and never silently falls back to $12. Continue the existing **$200 max for new listing UI** with explicit validation.
3. Host edit: show invalid input state, refuse save and send a verified numeric price to Supabase; remove the `|| 1` fallback.
4. Checkout: independently verify the stored listing rate before creating a hold or Stripe Checkout Session. Reject invalid rates with HTTP 409 and verify cent calculations remain integer-safe. Existing unrelated pricing/fees unchanged.
5. Review-only SQL `docs/sql-proposals/bug-005137-hourly-price-constraint.sql`: add `listings_hourly_price_valid_005137` check (`price >= 1 AND price = round(price, 2)`) as NOT VALID, then verify/validate in a controlled migration. It does not modify existing rows or add a $200 ceiling.
6. Automated JavaScript and disposable PostgreSQL tests cover new listing vs legacy listing policy, invalid create/edit, checkout fail-closed, SQL constraints and no historic repricing.

## Approval and release gates
- Have BetterQA verify existing QA and production price counts, and agree whether to maintain the *new-listing UI* $200 ceiling while leaving historic listings above it unchanged.
- Inventory any invalid existing database prices again before deployment. Resolve exceptions manually with the Host's approval; never silently modify a published price.
- **Do not deploy SQL independently.** Coordinate the app and SQL constraint in an approved isolated QA window; validate historical rows, payment calculations, and confirm rollback steps.
- Ensure direct API/PostgREST writes as a Host cannot insert/update prices below $1 even when UI validation is bypassed.
- In Stripe TEST, verify booking $1.00, $12.99 and existing $900 prices calculate correctly, while invalid values fail *before* a booking hold or payment intent.
- Confirm Host listing creation, editing, previews, map price labels and Driver checkout on desktop/mobile.
- Integrate with draft PR #165 (Stripe trusted return URLs), #159 (timezone), #167 (hold quotas) and #152 (checkout cents UI); those PRs modify checkout/booking code.
- No live Stripe transactions, DB migrations, listing price changes, production merges or active BetterQA QA changes were performed.

**Keep BUG-005137 open until BetterQA confirms real-app and database write protection after the controlled release.**
