# BetterQA BUG-005136 — Canadian postal-code validation
**Draft prepared October 18, 2026. No main merge, active QA/prod deployment, or database migration.**

## Source-confirmed issue
- `ListDrivewayView` Step 1 accepted any nonempty postal code and enabled **Continue** when text was present.
- The **"Address confirmed"** green notice appeared merely when all fields contained text, without verifying the street, location, or postal code.
- Step 8 preview/publish checked only that `form.postal` was populated; Step 1's **Skip for now** could bypass the preliminary field check.
- Host creation serializes a single `listings.address` text value rather than a separate `postal_code` column. No database postal-code format constraint is currently in the relevant schema.

## Draft repair
- New `src/lib/canadianPostalCode.js` validates the Canadian **A1A 1A1** pattern, excluding letters D/F/I/O/Q/U in every alphabetic position and excluding W/Z as the first letter. Accepts lowercase or a missing separator and normalizes to **UPPERCASE with one space**.
- Step 1 receives an accessible labeled postal-code input, autocomplete hint, visible specific validation message and `aria-invalid`. The Continue button stays disabled until the complete street/city/province and correctly formatted postal code are entered.
- Geocoding/address suggestions are treated as untrusted form data: auto-filled codes are normalized when valid, but invalid codes do not bypass validation.
- Step 8 lists invalid postal format as a blocking issue linking back to Step 1; `publish()` independently checks again **before any photo upload or Supabase listing insertion**.
- The former ungrounded **"Address confirmed"** text is replaced with **"Address details entered (not independently verified)"**.
- No change to the Host's chosen street, city, province, map coordinates, spots, Stripe, availability, photos or existing listings.

## Read-only baseline — important existing-data warning
- QA: **14 listings**, **6** with a recognizable Canadian postal suffix; **8** without a matching suffix.
- Production: **13 listings**, **10** with a matching suffix; **3** without one.
- These counts are a textual-format check, NOT proof the stored addresses are wrong; some may have valid postal codes in a different representation.
- **Do not change existing addresses or apply a blanket CHECK constraint.** Review the nonmatching listing records privately and establish a data-cleanup/legacy policy first.

## Optional database hardening (separate approval needed)
- `docs/sql-proposals/bug-005136-listing-postal-validation.sql` is a **review-only SQL proposal**, not executed.
- A narrowly scoped **BEFORE INSERT OR UPDATE OF address** trigger would reject non-formatted postal suffixes on new/changed listing addresses, including direct PostgREST writes bypassing the browser.
- It deliberately allows metadata-only updates on historical listings with nonconforming address text (price, photos, availability), while an actual address edit must be corrected to match.
- Because the app stores postal codes inside a combined `address` text field, a dedicated `postal_code` column with a CHECK constraint would be architecturally cleaner in a later migration. This trigger is a conservative intermediate option.
- The trigger does **not** prove that a syntactically correct postal code exists or belongs to the stated driveway/province. Full verification requires an authoritative postcode/address lookup, not merely regex validation.

## BetterQA regression cases
1. Type `L4J 1A1` (valid), `l4j1a1` (normalizes), `K1A 0B1` (rural), `M5V 2T6`, `X0A 0H0` — Continue enabled when other required fields complete.
2. Test `12345`, `ABCDE`, `ZZZ 999`, `W1A 1A1`, `L4D 1A1`, `L4J 1D1`, `L4J-1A1`, double spaces, too short/long — field warns; Continue disabled.
3. Select address-autocomplete suggestions with invalid or missing postal; manual correction still required.
4. Use **Skip for now** and then reach Preview: invalid/missing postal must appear in the error list, and the Publish action remains disabled.
5. Verify the actual `publish()` function rejects invalid postal **before photo upload** if state or step routing is manipulated.
6. Check the notice no longer promises that an address has been confirmed. Confirm mobile and desktop presentation/accessibility.
7. If a controlled SQL sandbox is approved, verify direct insert/address-edit rejects malformed suffixes, while older listings can still change *unrelated* fields. No live QA database migration as part of this PR.
8. Independently review the **8 QA and 3 production** nonmatching existing address rows and decide whether a dedicated postal column is preferred.

## Release boundary
- Review PR source and automated tests, then verify via a Vercel preview in an isolated browser/session.
- Do not merge into main or change active BetterQA QA, apply SQL, rewrite legacy listings, or change production.
- Coordinate eventual address hardening with privacy migration PR #161 and lightweight public listing API PR #157; keep exact addresses private after that transition.
- Keep BUG-005136 open pending independent BetterQA UI/preview verification, then decide separately about database-backed enforcement.
