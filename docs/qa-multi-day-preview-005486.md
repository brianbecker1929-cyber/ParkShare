# BUG-005486: multi-day Book Now departure preview

The reported 48- and 744-hour Custom bookings showed a correct total but incorrectly described departure as “today.” The property-zone formatter introduced for BUG-005466 already fixes this on the recovery QA branch. This change adds explicit coverage for BUG-005486 and records its QA handoff; it does not change application runtime code.

## Evidence

The earlier source at `403bb74a1bde74f7df0c87f19ac3313794283144` used `toLocaleTimeString` and appended `today` regardless of elapsed duration. The current pre-change source at `eebe0b42e9d17c02bc20c9ae2c2834033d1b8e04` uses `formatBookNowTimes(listing.timeZone, hours)` and includes the actual local calendar date, time, offset label and IANA zone.

Nine additional tests exercise the actual ListingDetail component and the formatter. With a fixed start of 2026-10-30 16:15 UTC (12:15 p.m. EDT in Toronto), they check:

| Custom duration | Toronto departure | Total at CAD 9.99/hour |
| --- | --- | --- |
| 48 hours | Nov 1, 2026, 11:15 a.m. EST | CAD 551.45 |
| 744 hours | Nov 30, 2026, 11:15 a.m. EST | CAD 8,547.44 |

Both rendered cases verify the actual end-date label, the quoted total and the matching availability request. Other assertions cover 48.25 hours, year and leap-year boundaries, Toronto previews under four device time zones, and a Vancouver property. Vancouver remains UTC-7 after March 2026 per the [B.C. government announcement](https://archive.news.gov.bc.ca/releases/news_releases_2024-2028/2026AG0013-000209.htm); its November expectation therefore differs from Toronto's fallback. A 744.25-hour input removes the preview and quote, makes no new availability request and cannot open payment.

As a regression-sensitivity check, an isolated temporary copy of the current component was changed to render the reported `Ends around 17:12 today` label. Both rendered date assertions fail on that mutation and pass on the unchanged application. This is a mutation check, not a claim that the modern harness successfully executes the entire historical UI.

## BetterQA retest

Use the recovery QA deployment from draft PR #252 and Stripe TEST only. Desktop and 390 × 844 browser acceptance are pending; automated component rendering does not establish visual acceptance.

1. Open a bookable 24/7 Toronto listing at CAD 9.99/hour (the report used “Driveway at 200 Front Street West”). Choose Book Now, then Custom.
2. Enter 48 and 744 hours in turn. Verify departure shows the real calendar date and local time with the property zone, including when crossing midnight, month/year boundaries and Toronto's DST change. It must not append “today” to a future date. Totals should be CAD 551.45 and CAD 8,547.44 respectively.
3. Repeat with a device zone different from Toronto. The preview must remain in the listing's verified time zone. Account for elapsed hours across offset changes rather than adding local calendar days.
4. Enter 744.25 hours. Verify a duration error, no departure/total preview, and disabled payment. Correct to 744 and verify availability is checked for that valid window before continuing.
5. Check the departure label and duration help fit on desktop and a 390 × 844 viewport. Record the actual start instant and listing zone with any discrepancy.

No booking, charge, refund or email was triggered for this verification. Draft PR #252 stays unmerged, production is unchanged, and manual BetterQA acceptance remains outstanding.
