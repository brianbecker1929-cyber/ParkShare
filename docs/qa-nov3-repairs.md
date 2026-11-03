# November 3 recovery QA repairs

Scope: recovery branch `qa/recovery-preflight-oct27`, draft PR 252. No production promotion, merge, database migration or Stripe configuration change.

## Changes and acceptance checks

| Ticket | Implementation | BetterQA acceptance |
| --- | --- | --- |
| BUG-005451 | Supply `mapTypeId: satellite` in the provider's constructor options as well as its top-level prop. Options retain satellite mode on subsequent updates. | Fresh Host session, wizard step 4: real satellite tiles at desktop and 390px; draw, remove, Back/Continue and return without reverting to roadmap. Provider tile delivery remains a live acceptance check. |
| BUG-005538 | Count actual marked spots, showing `No spots marked yet` when empty. Update the preview rectangle imperatively on pointer movement, avoiding React/provider listener replacement before the finishing click. Keep labels on one line; disabled remove controls let drawing clicks through. Continue requires a rentable marked spot in satellite mode; the existing Skip/manual-layout fallback remains. | Empty/add/remove-all counter; finish with one opposite-corner click repeatedly on desktop; mobile label and removal; Cancel/Escape, keyboard map-centre controls and eight-spot limit. |
| BUG-005537 | Use the existing native modal wrapper for Edit listing. Focus enters the dialog, cycles inside, Escape dismisses through the existing scoped close handler, and returns to that listing's Actions button. Detached return targets are ignored. | Open from the listing menu at desktop and 390px; Tab/Shift+Tab, input focus, Escape without saving, Close and Save. Check focus returns to the correct listing. |
| BUG-005495 | Match the hero image's 220px mobile / 380px desktop box. Supply 320/480/768/1122 AVIF variants with WebP fallback; preload only AVIF on the homepage using the same responsive source selection. Other routes do not preload the hero. Optimize both footer logos, reserve their dimensions and load them lazily. | Repeat the same mobile LCP measurement used for the prior 3.75s result. Target remains 2.5s; transfer-size reduction alone does not establish a pass. Check appearance and absence of duplicate preload downloads. |

The 768px AVIF is 49,444 bytes versus 275,342 bytes for the previous 1122px WebP. Asset dimensions and transparency are checked; the optimized artwork was visually compared at display size. Recreate exports with `node scripts/prepare-home-images.mjs`.

A pre-repair PageSpeed mobile run confirmed the hero as LCP (5.254s, FCP 2.432s, TBT 0, CLS 0), plus a competing 334KiB footer logo. Report: https://pagespeed.web.dev/analysis/https-parkshare-qa-git-qa-recovery-preflight-oct27-eska-technologies-vercel-app/1f3bmgyx5n?form_factor=mobile

## Verification

- Focused map, listing edit, keyboard dialog, homepage image and bundle suite: 57 passed.
- New map/dialog regressions fail against the pinned pre-repair App source and pass with these changes.
- Full local suite: 1,690 passed, 0 failed, 2 database-dependent skips. Build passed.
- The local fixture server cannot be reached by the remote browser; this does not establish an authenticated live Host walkthrough. Provider satellite imagery and BetterQA's timing threshold remain acceptance checks.
- The password dictionary remains deferred. Initial JavaScript is approximately 288KB gzip, within the existing reduced budget.

## Email blocker: BUG-005536 / BUG-005527

No email-delivery fix is claimed in this patch. For PK-119, Resend accepted both confirmations and both reminders, then classified all four as transient bounces. The reminder job ran, reported no send failures in the requested window, and produced one halfway and one ending reminder. Reminder payloads are Driver-only, without Host CC/BCC/Reply-To.

The sending domain and configured SPF/DKIM records are verified; current quota is not exhausted. Other recent booking emails delivered, while the affected Mailinator messages bounced. These facts do not identify the rejecting SMTP response or prove an inbox-side cause. The connected Resend API does not expose the bounce diagnostic; the Resend dashboard requires sign-in in the available browser. Inspect the message's Bounce details/SMTP response before changing senders, suppression, templates or retry policy. Actual confirmation/Host/reminder inbox delivery and the reported chat notification still require verification. Keep BUG-005536 open and BUG-005527 blocked on inbox acceptance.

The separate production-domain TEST webhook returning 500 remains an open launch-readiness item outside this patch.
