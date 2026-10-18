-- BUG-005156 — SCHEDULED RESERVATIONS PROPERTY-TIMEZONE MIGRATION PROPOSAL.
-- REVIEW ONLY. DO NOT APPLY TO PRODUCTION OR ACTIVE BETTERQA QA.
-- A coordinated versioned deployment MUST precede any public use of the
-- app-side UTC scheduler, because new code selects these nullable columns.
--
-- Critical historical reservation rule:
-- DO NOT UPDATE historical paid scheduled bookings, their session_range,
-- booked dates, or paid times as part of this migration. They were saved
-- using the previous UTC interpretation; review existing paid future bookings
-- one at a time with BetterQA/Host before any adjustment.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS time_zone text;
-- Do NOT guess Toronto for all Canadian listings. Time zones must be
-- independently resolved from the driveway's exact geographic coordinates
-- by a trusted server-side time-zone service, checked and approved, then
-- backfilled per listing before scheduled checkout is enabled.
ALTER TABLE public.listings
  ADD CONSTRAINT listings_time_zone_max_length
  CHECK (time_zone IS NULL OR length(time_zone) BETWEEN 3 AND 100);

-- Critical: Hosts have direct authenticated UPDATE access to their own
-- listing rows. Without this trigger they could spoof a different zone via
-- the Data API. Protect the server-approved IANA time-zone assignment.
CREATE OR REPLACE FUNCTION public.listings_enforce_trusted_time_zone()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $tz_guard$
BEGIN
  IF (
    (TG_OP = 'INSERT' AND NEW.time_zone IS NOT NULL)
    OR (TG_OP = 'UPDATE' AND NEW.time_zone IS DISTINCT FROM OLD.time_zone)
  ) AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',
      MESSAGE='Only a trusted ParkShare server can assign a property time zone';
  END IF;
  RETURN NEW;
END;
$tz_guard$;
DROP TRIGGER IF EXISTS listings_trusted_time_zone_trigger ON public.listings;
CREATE TRIGGER listings_trusted_time_zone_trigger
BEFORE INSERT OR UPDATE ON public.listings
FOR EACH ROW EXECUTE FUNCTION public.listings_enforce_trusted_time_zone();

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS scheduled_starts_at timestamptz;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS property_time_zone text;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_canonical_schedule_complete
  CHECK (
    scheduled_starts_at IS NULL OR
    (booking_date IS NOT NULL AND start_hour IS NOT NULL
     AND property_time_zone IS NOT NULL
     AND length(property_time_zone) BETWEEN 3 AND 100)
  ) NOT VALID;
-- NOT VALID allows historical preservation while enforcing new/updated rows.
-- Existing historical rows are intentionally left with NULL canonical fields.

-- The preexisting trigger computes a tstzrange using an unqualified local
-- datetime AT TIME ZONE 'UTC'. Replacing it with canonical priority allows
-- new bookings to be stored accurately while legacy bookings keep their
-- existing interval and UTC interpretation.
CREATE OR REPLACE FUNCTION public.bookings_compute_session_range()
RETURNS trigger LANGUAGE plpgsql AS $trigger$
DECLARE
  v_start timestamptz;
BEGIN
  IF new.scheduled_starts_at IS NOT NULL THEN
    IF new.booking_date IS NULL OR new.start_hour IS NULL
      OR new.property_time_zone IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023',
        MESSAGE='Canonical scheduled start requires property timezone snapshot';
    END IF;
    v_start := new.scheduled_starts_at;
  ELSE
    -- Existing paid bookings: never reinterpret the historical clock entry
    -- unless BetterQA approves an explicit booking-specific reconciliation.
    v_start := COALESCE(
      CASE WHEN new.booking_date IS NOT NULL AND new.start_hour IS NOT NULL
        THEN (new.booking_date::date + (new.start_hour || ' hours')::interval)
          AT TIME ZONE 'UTC'
        ELSE new.paid_at
      END,
      new.paid_at
    );
  END IF;
  IF v_start IS NULL OR new.hours IS NULL OR new.hours <= 0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid booking interval';
  END IF;
  new.session_range := tstzrange(
    v_start,
    v_start + (new.hours || ' hours')::interval,
    '[)'
  );
  RETURN new;
END
$trigger$;
COMMIT;

-- REQUIRED IN A SEPARATE, APPROVED, ROLLOUT PROCEDURE
-- 1. Audit ALL paid future reservations, holds, time-zone aliases, conflicts,
--    and old sessions before SQL changes; snapshot and prepare rollback.
-- 2. Resolve per-listing IANA time_zone using geocoded location; listings with
--    missing/outdated coordinates should remain NULL, blocking only scheduled
--    checkouts (instant bookings unaffected).
-- 3. Deploy this DB schema/trigger in coordinated QA maintenance window,
--    then deploy the app changes simultaneously, NOT as stand-alone fixes.
-- 4. Run Toronto/Vancouver/St_Johns/Regina, DST gap/fold, remote-browser,
--    booked-spots, reminder/email, Checkout, webhook, duplicate and refund QA.
-- 5. Verify old bookings are bit-for-bit unchanged, and new booked ranges
--    match their signed registered holds' starts_at / ends_at UTC.
-- 6. Handle historical mis-bookings by explicit one-by-one customer approvals
--    and preserve Stripe/financial records without rewrite or double-charge.
