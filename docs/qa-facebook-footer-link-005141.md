# ParkShare BetterQA — BUG-005141: Facebook footer link cannot be verified
**October 18, 2026 · review-only draft · active BetterQA QA and production unchanged**

## Observed issue
- `HomeFooter` in `src/App.jsx` includes the clickable destination `https://www.facebook.com/ParkerParksHere/`, advertised as **ParkShare on Facebook**.
- A current independent public-web check could **not verify** a public official ParkShare Facebook page at this URL. The direct fetch failed and generic web results were not an authoritative confirmation of ownership or availability.
- This does **not** prove the page is deleted or nonexistent: Facebook can require a logged-in session, block automated access, or restrict regional access.
- Therefore **do not guess an alternative URL**, reuse links from unrelated ParkShare businesses, or claim to have resolved a Facebook account issue.

## Draft mitigation
- Replace the clickable footer Facebook `<a>` with a non-clickable `<span>` bearing the **same "f" icon** and existing circular styling.
- Give it a clear accessible label and tooltip: **"Facebook link being verified"**; match the 45%-opacity, disabled/non-pointer styling already used for X and LinkedIn.
- Remove the unverified Facebook destination from the JSX source, so browser users cannot be sent there by this control.
- Retain Instagram and YouTube `target="_blank" rel="noopener noreferrer"` links; keep X and LinkedIn placeholders unchanged.
- The patch affects only the social icon inside `HomeFooter`, which is shared across site routes; no booking, payment, listing, Supabase, auth or styling system changes.

## BetterQA independent verification
1. Inspect the footer across homepage, About Us, Help, Trust & Safety, and responsive mobile/desktop.
2. Confirm the **Facebook icon remains visible**, looks disabled and never opens a blank/broken/new tab when clicked or tapped.
3. Verify the icon is not a link or keyboard-focusable button, has a descriptive accessible label, and does not trap keyboard navigation.
4. Verify Instagram and YouTube links still work as before; X and LinkedIn continue to display their preexisting coming-soon states.
5. Inspect console for errors; check the tab order and CTA spacing in narrow mobile footers.
6. **Product-owner action:** confirm whether `facebook.com/ParkerParksHere/` is the controlled public ParkShare page, using a logged-out/private browser and a non-admin visitor in Canada. If not, supply the exact, owned and publicly working Facebook Page URL.
7. Once the owner and BetterQA confirm the official destination, restore a genuine secure `<a href="...">` in a follow-up code review and independently test the redirect from a non-admin device. Do not claim this placeholder is a permanent working Facebook link.

## Acceptance / release boundary
- Automated source-based regression tests prove the link is no longer clickable in JSX and other social icon markup remains unchanged; **they do not prove actual Facebook site availability**.
- This issue should remain **open / partially mitigated** until the verified official link is installed and BetterQA confirms it works, unless the owner explicitly chooses to publish a permanent disabled placeholder.
- The draft PR is **not merged**, and no active BetterQA QA or production deployments have been made.
