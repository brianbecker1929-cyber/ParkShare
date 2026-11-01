# BUG-005440 — explicit checkbox names and native labels

Recovery QA / Stripe TEST only. The report names listing-wizard Step 5 features
and the Add your event consent checkbox as controls announced only as “on”. No
attachments were supplied. Current source already had wrapping labels; this
repair makes associations explicit and verifies computed names. It does not claim
to have reproduced or passed VoiceOver in this environment.

## Change

- Step 5 renders a small ListingFeatureFields component with a named Features
  fieldset, the same six visible choices and the same state keys as before.
- Each checkbox has a component-scoped React useId identifier, a native label
  with matching htmlFor and a unique visible-text span referenced by aria-labelledby.
  IDs remain stable during a mounted form's renders and distinct across forms.
  Native checkbox/checked/focus semantics and label activation are preserved.
- Event consent uses its existing form-scoped ID with explicit htmlFor and a
  visible-text aria-labelledby reference. Its required, checked, disabled,
  aria-invalid and error aria-describedby behavior remain intact. Error text
  does not replace the name. The visible confirmation wording is unchanged.
- Input values keep native checkbox conventions: the DOM value may remain “on”;
  the computed accessible Name is the visible feature/confirmation text. Retest
  the accessibility tree's Name and spoken label, alongside the checked state.
- Publishing still receives the existing feature booleans. Event submission still
  receives authorized as a boolean through the existing guarded handler. No
  transport endpoint, validation, booking, payment or database behavior changes.

## Verification

Pinned jsdom and dom-accessibility-api are development-only dependencies used
for actual React DOM rendering and W3C accessible-name computation. Tests cover
all seven names, fieldset name, native label clicks, controlled-state changes,
unchanged feature keys, rerender ID stability, duplicate forms, event consent
required/invalid states and accessible error descriptions. The actual wizard
binding and event form are exercised; no real event is submitted.

Explicit-label integration checks fail against the prior App. This is evidence
for the new associations; the prior wrapping labels were valid implicit markup,
so these checks are not presented as reproducing the reported VoiceOver output.
Existing event transport/validation/duplicate-submit and listing state tests
remain applicable. Test libraries are excluded from the deployed browser bundle.

Actual browser/screen-reader automation was unavailable. Computed DOM names and
native DOM label activation do not substitute for BetterQA's VoiceOver acceptance.

## BetterQA retest

1. On desktop Chrome/macOS with VoiceOver, sign in as a Host and reach List Your
   Driveway Step 5. Tab through all six controls. Confirm each spoken Name matches
   its visible text, the checkbox role and checked state are announced, and no
   control is identified only by its native value.
2. Use Space and click/tap each full label at desktop and 390x844. Each action must
   toggle only its matching feature. Advance/back through the wizard and confirm
   selections persist and publishing still uses those selected features.
3. Open Discover > Events & Festivals > Add your event. Tab to consent; verify the
   full visible confirmation is its accessible Name, with checkbox/required state.
   Label click and Space must toggle it without submitting the form.
4. Submit incomplete details with consent unchecked. Confirm the inline error is
   associated and announced as a description, with the original consent Name
   retained. Correct it; confirm its own error clears and duplicate-send/pending
   protections remain. Use only approved QA event fixtures for any actual submit.
5. Reopen forms and inspect IDs/references in the accessibility tree. Verify there
   are no duplicate IDs, missing labels or references to a different form.
6. Record browser/screen-reader versions and observed names. Keep QA / Stripe TEST;
   leave production unchanged.

References:

- https://www.w3.org/WAI/tutorials/forms/labels/
- https://github.com/eps1lon/dom-accessibility-api
