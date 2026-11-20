# BUG-005445 — edit published availability and pause new reservations

Recovery QA / Stripe TEST only. The screenshot confirms an editor limited to
price, description, five mismatched features and spots. Hosts can now edit title,
weekly hours/presets and special dates, and pause/resume a listing from Edit listing.

## Host behavior

- Edit listing loads the saved title, six publishing feature choices (Covered,
  CCTV, Well-lit, Snow removal, EV charging, Gated), physical bays, availability,
  verified property time zone and pause flag. Existing legacy features remain
  visible/removable instead of being silently discarded.
- The availability editor supports all existing presets, per-day open/closed
  switches, up to eight time windows per day, and up to 100 special-date ranges
  with closed/all-day/custom hours. Preset changes preserve special dates.
  New schedule controls have native labels/keyboard semantics and 44px targets.
- Schedules use the database-owned property clock. Current/upcoming exceptions
  are loaded; entirely expired ranges are omitted and an ongoing range starts
  at today when edited. Stored booking history is never rewritten. Dates must
  satisfy the existing today-through-12-calendar-month rules and end ordering.
- Saving validates title, rate, rentable bays, weekly windows and special dates.
  A resumed listing needs an available period. A paused listing may retain a
  closed schedule. Saving disables the editor; Cancel does not write.
- Legacy listings without a verified time zone remain pausable and can edit
  their other fields without rewriting the existing availability JSON. Schedule
  editing requires property-zone verification; the UI states this explicitly.
  The recovery project had six such legacy rows at inspection.
- One owner-filtered update saves the editable values together. The editor's
  captured property zone cannot be replaced by a save payload. Canonical title,
  schedule and pause readback must match before success. Existing account,
  request-generation, immutable-payload and duplicate-save guards are retained.
  Empty representation fallback still performs one bounded owner read, never
  replays a mutation, and compares the new settings too.
- Dashboard Active/Paused labels and Active listings count use persisted pause
  state. The existing mutation journal includes the new fields so older reads
  cannot revert a save; genuinely newer reads remain authoritative.

## Pause boundary and Driver behavior

`listings.is_paused boolean not null default false` is independent of the saved
schedule. Migration `20261101195507_qa_listing_pause_005445.sql` is additive and
has been applied only to recovery QA. Existing 35 listings remained active by
default; no hosted listing, booking or hold was edited or removed for testing.

Public browse adds the `paused` enum through the existing bounded status lookup,
without exposing the Host, clock or raw schedule. Cards say listing paused rather
than incomplete payouts. The live no-store detail check reads pause before Stripe;
paused details show an early notice and cannot open spot selection/payment.
Cached browse can lag within its existing 60s/120s stale window; detail and checkout
remain independent. Retry/focus after resume can enable a currently ready listing.
Availability API returns zero free bays with `listing_paused`, including legacy
unverified-zone listings. Occupancy and outside-hours messages stay distinct.

Both booking and extension checkout reject pause before provider reads. A private
SECURITY INVOKER trigger on booking_holds also rejects new hold INSERTs with
SQLSTATE P0063. It takes a shared lock on the listing row, serializing admission
against a Host pause UPDATE. API handlers map that race to an explanatory 409
before creating Stripe Checkout. Existing RLS ownership/Host-role rules remain;
browser roles cannot invoke the private trigger function.

Pause stops **new reservations and additional time**. A confirmed reservation,
paid outcome, schedule snapshot or hold already admitted is preserved. Stripe
checkouts already in progress can finish against their existing hold, including
extensions initiated before pause. The UI explains this boundary. Pausing does
not cancel, refund, expire a Checkout Session or delete a listing. Those operations
and the separate cancelled-only archival requirement are outside this repair.

## Verification

Actual editor, widget, hooks, public/availability endpoints and both checkout
handlers are exercised with synthetic records. Coverage includes presets/windows,
exception editing and cleared invalid dates, title/features, pause/resume, legacy
zones, immutable save captures, mismatched readback, UI blocking and concurrent
pause rejection before Stripe. New editor regressions fail against prior source.

A disposable local Postgres WASM rehearsal passed 12 schema/history/guard checks.
The native PostgreSQL CI rehearsal also tests concurrent admission waiting for a
pause row lock before rejecting. Migration reapply, booking/hold preservation,
Host ownership and resume are covered. Recovery catalog reads verified the new
column, private invoker trigger and default-active rows; security advisors gained
no new findings. No real hosted pause/save, payment, refund or email was triggered.
Browser automation is unavailable; BetterQA interactive acceptance is pending.

## BetterQA — PARK-TC-032, PARK-TC-034 and PARK-TC-104

1. On desktop and 390x844, edit a disposable Host listing. Change title and the
   publishing features (including Snow removal/EV charging). Save, confirm the
   message/card and reload to verify persistence. Legacy features remain removable.
2. Change preset, day hours and multiple windows. Add/edit/remove blocked, all-day
   and custom-hour special dates. Verify property-local behavior in a browser using
   a different time zone. Reject reversed/empty times, past or out-of-horizon dates.
3. Pause a listing and save. Confirm Paused/count state after reload. Driver browse
   should mark it paused after cache refresh; details immediately block selection.
   Direct new-booking and extension Checkout attempts must return listing_paused
   without opening Stripe or allocating a new hold.
4. Verify existing confirmed reservations, Driver access, booked times, Host booking
   history and financial history remain intact. An already-open Stripe TEST checkout
   can finish against its prior hold; document that timing when retesting a race.
5. Resume, save and reload. Verify the original schedule and special dates remain.
   An eligible Driver can choose a valid bay/vehicle within allowed hours; closed
   hours and exceptions still block. Existing incomplete-Host payout guards apply.
6. Fail/throttle saves, double-click, cancel and switch accounts A-B-A. No old result
   may update the new account/editor or claim an unverified save. A legacy listing
   with no verified zone must still pause without replacing its schedule.
7. Keep QA / Stripe TEST. Do not merge or deploy to production.

References:

- https://supabase.com/docs/reference/javascript/update
- https://supabase.com/docs/reference/javascript/using-modifiers-select
- https://www.postgresql.org/docs/current/explicit-locking.html
