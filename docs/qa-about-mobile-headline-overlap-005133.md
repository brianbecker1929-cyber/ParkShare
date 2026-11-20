# BetterQA BUG-005133 — About Us mobile heading/mascot overlap
**October 18, 2026 — isolated preview CSS repair (draft only).**

## Confirmed source-level cause
- The mobile Host and Driver marketplace cards use a parent 3-row CSS grid.
- The content wrapper spans parent rows 1–2, including the card heading in its second internal row, **while the mascot is independently placed in parent row 2**.
- Mascot sizes of 150–154% and manual translate/scale offsets can visually project the approved William/Parker cutouts into the heading.
- Several prior mobile adjustments use `!important`; this repair is appended after them, scoped to the About page and mobile widths, rather than replacing unrelated styles or changing approved character artwork.
- The source confirms overlapping layout rules; final rendered overlap must be independently checked with screenshots at affected viewport sizes.

## Draft fix
- For **both** About marketplace cards, the presentational text wrapper becomes `display: contents` on viewports ≤819 px, allowing the heading and mascot to participate in the **same parent grid** rather than overlapping independent grid contexts.
- Dedicated mobile rows: audience label = 1; H3 heading = 2 (full width); mascot = rows 3–4, left; supporting paragraphs = rows 3 and 4, right; CTA button = row 5, centered.
- Mascots keep their original WebP assets, responsive `srcSet`, transparent cutouts, soft-shadow styling and accessible `alt` descriptions. Only their mobile **layout box** is contained at 100% of its column (230 px high maximum), and old translate/scale offsets are reset.
- Text remains selectable, visible and accessible. Long translated / wrapped headings get `overflow-wrap` and a minimum-width guard; tight viewports ≤360 px get adjusted columns and font sizing.
- Viewports ≥820 px and other ParkShare pages are outside the new CSS media queries.

## Automated test and review
- New `test/qa-about-mobile-headline-overlap-005133.test.js` verifies selector coverage for both cards, mutually exclusive title and mascot grid rows, copy and CTA placement, and preservation of mascot assets/text/buttons.
- GitHub Actions and Vercel preview checks must pass. CSS structure tests are **not a substitute for visual screenshots**, so BetterQA should compare mobile preview rendering at 320, 360, 375, 390, 430, 620, 768 and 819 px.
- Explicitly inspect the 820 px desktop/tablet breakpoint for unchanged layout. Verify long text/wrapped headings, 200% zoom, reduced motion, screen-reader reading order and tappable CTA buttons.
- Confirm neither William's thumbs-up pose nor Parker's map pose loses visible fingers/head or blocks the text. Compare glow and host amber / driver navy colours against the approved site.
- Check that both cards remain within the page width with no horizontal overflow.

## Release boundary
**DRAFT only.** No production merge, no active BetterQA QA change, no database migration, no payment or listing data edits. Approve only after BetterQA side-by-side visual comparison with the last reported mobile screenshot; automated green tests alone do not close BUG-005133.
