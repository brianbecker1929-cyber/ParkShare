-- QA-ONLY release authorized by Brian on October 19, 2026.
-- Do not apply to ParkShare production. Full transaction; proposals are NOT replayed separately.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
SELECT pg_advisory_xact_lock(20261019,187);
CREATE SCHEMA qa_release_backup_20261019;
REVOKE ALL ON SCHEMA qa_release_backup_20261019 FROM PUBLIC, anon, authenticated;
CREATE TABLE qa_release_backup_20261019.catalog (
  captured_at timestamptz NOT NULL DEFAULT now(),
  old_commit text NOT NULL,
  definition jsonb NOT NULL
);
INSERT INTO qa_release_backup_20261019.catalog(old_commit,definition)
SELECT '42f27f85a18bf1c730b5d5d200b4ee8fdd3ec7e6',jsonb_build_object(
  'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'),
  'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),
  'policies',(SELECT jsonb_agg(to_jsonb(p)) FROM pg_policies p WHERE schemaname IN ('public','storage')),
  'triggers',(SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'definition',pg_get_triggerdef(t.oid))) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
  'columns',(SELECT jsonb_agg(to_jsonb(c)) FROM information_schema.columns c WHERE table_schema='public'),
  'table_acls',(SELECT jsonb_agg(jsonb_build_object('name',c.oid::regclass::text,'acl',c.relacl::text,'rls',c.relrowsecurity)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
  'column_acls',(SELECT jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'column',a.attname,'acl',a.attacl::text)) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL),
  'indexes',(SELECT jsonb_agg(to_jsonb(i)) FROM pg_indexes i WHERE schemaname='public')
);
CREATE TABLE qa_release_backup_20261019.bucket AS SELECT id,public FROM storage.buckets WHERE id='listing-photos';
CREATE TABLE qa_release_backup_20261019.table_counts(table_name text PRIMARY KEY,row_count bigint NOT NULL);
DO $backup$
DECLARE t record; source_count bigint; copy_count bigint; mismatch bigint;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE MODE',t.tablename);
    EXECUTE format('CREATE TABLE qa_release_backup_20261019.%I AS TABLE public.%I',t.tablename,t.tablename);
    EXECUTE format('REVOKE ALL ON TABLE qa_release_backup_20261019.%I FROM PUBLIC, anon, authenticated',t.tablename);
    EXECUTE format('SELECT count(*) FROM public.%I',t.tablename) INTO source_count;
    EXECUTE format('SELECT count(*) FROM qa_release_backup_20261019.%I',t.tablename) INTO copy_count;
    EXECUTE format('SELECT count(*) FROM ((SELECT to_jsonb(s) row FROM public.%I s EXCEPT ALL SELECT to_jsonb(b) FROM qa_release_backup_20261019.%I b) UNION ALL (SELECT to_jsonb(b) FROM qa_release_backup_20261019.%I b EXCEPT ALL SELECT to_jsonb(s) FROM public.%I s)) differences',t.tablename,t.tablename,t.tablename,t.tablename) INTO mismatch;
    IF copy_count<>source_count OR mismatch<>0 THEN RAISE EXCEPTION 'QA recovery copy failed for %',t.tablename; END IF;
    INSERT INTO qa_release_backup_20261019.table_counts VALUES(t.tablename,source_count);
  END LOOP;
END;
$backup$;
CREATE TABLE qa_release_backup_20261019.verified_zone_cells (
 south numeric NOT NULL, west numeric NOT NULL, time_zone text NOT NULL,
 verified_source text NOT NULL, verified_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(south,west)
);
REVOKE ALL ON ALL TABLES IN SCHEMA qa_release_backup_20261019 FROM PUBLIC, anon, authenticated;


-- Integrated tested proposal 1: bug-005118-unpaid-hold-rate-limits.sql
-- BUG-005118: proposed rate limits for Stripe Checkout parking holds.
-- REVIEW ONLY. Not applied to active BetterQA QA or production.
-- Requires checkout API support for custom SQLSTATE P0058 before deployment.
-- Based on currently deployed registered-checkout hold procedure (migration 011).
--
-- Product thresholds proposed for BetterQA review:
--   2 active unpaid holds per Driver across all listings,
--   4 successfully created holds per rolling 2 hours,
--   12 successfully created holds per rolling 24 hours.
-- No IP/device tracking or public visibility of other Drivers' attempts.
--
-- Deploy with approved app code in a controlled QA window only.

set local lock_timeout = '5s';

create table if not exists public.booking_hold_attempts (
  id bigint generated always as identity primary key,
  renter_id uuid not null references auth.users(id) on delete cascade,
  hold_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index if not exists booking_hold_attempts_renter_created_idx
  on public.booking_hold_attempts (renter_id, created_at desc);
alter table public.booking_hold_attempts enable row level security;
revoke all on public.booking_hold_attempts from public, anon, authenticated;
grant select, insert on public.booking_hold_attempts to service_role;

create or replace function public.create_booking_hold(
  p_listing_id bigint,
  p_renter_id uuid,
  p_spot_label text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_capacity integer;
  v_taken integer;
  v_label text := nullif(upper(trim(p_spot_label)), '');
  v_hold_id uuid;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception using errcode = '22023', message = 'Invalid booking window';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '31 minutes' then
    raise exception using errcode = '22023', message = 'Invalid hold expiry';
  end if;

  -- Serialize a renter's requests ACROSS ALL listings before taking the
  -- existing per-listing capacity lock. This prevents simultaneous checkout
  -- requests from bypassing the quota.
  if p_renter_id is null then
    raise exception using errcode = '22023', message = 'Driver identity required';
  end if;
  perform pg_advisory_xact_lock(5118, hashtext(p_renter_id::text));
  perform pg_advisory_xact_lock(p_listing_id);

  select greatest(coalesce(spaces, 1), 1)
    into v_capacity
  from public.listings
  where id = p_listing_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Listing not found';
  end if;

  -- Protect legitimate Drivers and Hosts from repeated unpaid Checkout
  -- sessions. A successful server-issued hold is counted for 24 hours even
  -- if the related Stripe Session is abandoned or later expires.
  -- Verify existing active holds first (including ones predating this patch).
  if (
    select count(*) from public.booking_holds h
    where h.renter_id = p_renter_id and h.expires_at > now()
  ) >= 2 then
    raise exception using errcode = 'P0058',
      message = 'Too many active parking checkouts';
  end if;
  if (
    select count(*) from public.booking_hold_attempts a
    where a.renter_id = p_renter_id
      and a.created_at > now() - interval '2 hours'
  ) >= 4 then
    raise exception using errcode = 'P0058',
      message = 'Parking checkout started too often';
  end if;
  if (
    select count(*) from public.booking_hold_attempts a
    where a.renter_id = p_renter_id
      and a.created_at > now() - interval '24 hours'
  ) >= 12 then
    raise exception using errcode = 'P0058',
      message = 'Daily parking checkout limit reached';
  end if;

  -- Retain recently expired holds for seven days. A legitimate card
  -- payment can be completed before expiry but reach our signed webhook
  -- after expiry, so immediately purging the trusted checkout evidence
  -- would make a paid reservation impossible to reconcile.
  delete from public.booking_holds where expires_at <= now() - interval '7 days';

  select
    (select count(*) from public.bookings b
      where b.listing_id = p_listing_id
        and b.status = 'confirmed'
        and b.session_range && tstzrange(p_starts_at, p_ends_at, '[)'))
    +
    (select count(*) from public.booking_holds h
      where h.listing_id = p_listing_id
        and h.expires_at > now()
        and h.starts_at < p_ends_at
        and p_starts_at < h.ends_at)
    into v_taken;

  if v_taken >= v_capacity then
    raise exception using errcode = 'P0001', message = 'Booking window is full';
  end if;

  if v_label is not null and (
    exists (
      select 1 from public.bookings b
      where b.listing_id = p_listing_id
        and b.status = 'confirmed'
        and upper(trim(b.spot_label)) = v_label
        and b.session_range && tstzrange(p_starts_at, p_ends_at, '[)')
    )
    or exists (
      select 1 from public.booking_holds h
      where h.listing_id = p_listing_id
        and h.expires_at > now()
        and upper(trim(h.spot_label)) = v_label
        and h.starts_at < p_ends_at
        and p_starts_at < h.ends_at
    )
  ) then
    raise exception using errcode = 'P0001', message = 'Selected parking spot is held';
  end if;

  insert into public.booking_holds
    (listing_id, renter_id, spot_label, starts_at, ends_at, expires_at)
  values
    (p_listing_id, p_renter_id, v_label, p_starts_at, p_ends_at, p_expires_at)
  returning id into v_hold_id;

  -- This audit survives removal of a hold after payment, error or expiration
  -- and prevents repeated no-payment retry loops.
  insert into public.booking_hold_attempts (renter_id, hold_id)
    values (p_renter_id, v_hold_id);

  return v_hold_id;
end;
$$;


-- The original procedure is service-role-only; preserve that boundary.
revoke all on function public.create_booking_hold(bigint, uuid, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_booking_hold(bigint, uuid, text, timestamptz, timestamptz, timestamptz)
  to service_role;



-- Integrated tested proposal 2: qa-atomic-extensions-and-refunds.sql
-- REVIEW-ONLY DRAFT. Do NOT execute on live or BetterQA QA databases.
-- Coordinate an approved migration using "supabase migration new" first.
-- Schema inspected READ-ONLY on ParkShare-QA, October 17, 2026.

-- Held extension interval is bound to its registered Checkout session.
-- Only service_role can access pending_booking_extensions.
ALTER TABLE public.pending_booking_extensions
 ADD COLUMN IF NOT EXISTS hold_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS pending_booking_extensions_hold_id_unique
 ON public.pending_booking_extensions(hold_id) WHERE hold_id IS NOT NULL;

ALTER TABLE public.booking_extensions
 ADD COLUMN IF NOT EXISTS stripe_refund_id text,
 ADD COLUMN IF NOT EXISTS refund_status text,
 ADD COLUMN IF NOT EXISTS refund_amount numeric,
 ADD COLUMN IF NOT EXISTS refund_failure_reason text,
 ADD COLUMN IF NOT EXISTS charge_amount_refunded numeric,
 ADD COLUMN IF NOT EXISTS charge_fully_refunded boolean,
 ADD COLUMN IF NOT EXISTS charge_disputed boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS refund_reconciled_at timestamptz;

-- Reserve the extension tail using PostgreSQL's ORIGINAL microsecond-
-- precision booking endpoint, not JS Date.toISOString() (millisecond
-- precision). Both hold reservation and paid extension use this same end.
-- Reuses the existing listing-scoped atomic create_booking_hold RPC.
CREATE OR REPLACE FUNCTION public.reserve_extension_checkout_hold(
  p_booking_id bigint, p_renter_id uuid, p_added_hours numeric,
  p_expires_at timestamptz
) RETURNS TABLE(hold_id uuid, starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $reserve$
DECLARE
  b public.bookings%ROWTYPE;
  v_listing_id bigint;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF p_booking_id IS NULL OR p_renter_id IS NULL
     OR p_added_hours IS NULL OR p_added_hours < 0.25 OR p_added_hours > 24
     OR (p_added_hours * 4) <> trunc(p_added_hours * 4)
     OR p_expires_at IS NULL
  THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid extension hold request'; END IF;

  SELECT listing_id INTO v_listing_id FROM public.bookings WHERE id=p_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Booking missing'; END IF;
  -- PR #167 changes create_booking_hold to acquire the DRIVER quota lock
  -- before the LISTING lock. An extension must obtain these in that same
  -- global order before it calls create_booking_hold, or parallel new-booking
  -- and extension checkouts for this Driver/listing could deadlock.
  -- pg_advisory_xact_lock is reentrant for this PostgreSQL transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(5118, hashtext(p_renter_id::text));
  PERFORM pg_catalog.pg_advisory_xact_lock(v_listing_id);
  SELECT * INTO b FROM public.bookings WHERE id=p_booking_id FOR UPDATE;
  IF NOT FOUND OR b.listing_id IS DISTINCT FROM v_listing_id
      OR b.renter_id IS DISTINCT FROM p_renter_id
      OR b.status <> 'confirmed' OR b.session_range IS NULL
      OR NOT (lower(b.session_range) <= now() AND now() < upper(b.session_range))
  THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Booking is not active or does not belong to Driver'; END IF;

  v_start := upper(b.session_range);
  v_end := v_start + (p_added_hours::text || ' hours')::interval;
  RETURN QUERY SELECT public.create_booking_hold(
    b.listing_id, b.renter_id, b.spot_label, v_start, v_end, p_expires_at
  ), v_start, v_end;
END;
$reserve$;
REVOKE ALL ON FUNCTION public.reserve_extension_checkout_hold(bigint,uuid,numeric,timestamptz)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_extension_checkout_hold(bigint,uuid,numeric,timestamptz)
  TO service_role;

-- Invoked only by the service-role webhook after Stripe PaymentIntent validation.
-- Insert and increment are ONE transaction. Failure of either rolls back both.
CREATE OR REPLACE FUNCTION public.apply_paid_booking_extension(
 p_checkout_session_id text, p_booking_id bigint, p_renter_id uuid,
 p_added_hours numeric, p_expected_total_cents integer,
 p_payment_intent_id text, p_charge_id text,
 p_connected_account_id text, p_paid_at timestamptz
) RETURNS TABLE(applied boolean, resulting_hours numeric)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $func$
DECLARE
 p public.pending_booking_extensions%ROWTYPE;
 b public.bookings%ROWTYPE;
 e public.booking_extensions%ROWTYPE;
 v_own_hold public.booking_holds%ROWTYPE;
 v_listing_id bigint;
 v_capacity int;
 v_old_end timestamptz;
 v_new_end timestamptz;
 v_range tstzrange;
 v_spot text;
 v_other_bookings bigint;
 v_other_holds bigint;
BEGIN
 IF nullif(p_checkout_session_id,'') IS NULL
 OR nullif(p_payment_intent_id,'') IS NULL
 OR nullif(p_connected_account_id,'') IS NULL
 OR p_paid_at IS NULL OR p_booking_id IS NULL OR p_renter_id IS NULL
 OR p_expected_total_cents IS NULL OR p_expected_total_cents < 50
 OR p_added_hours IS NULL OR p_added_hours <= 0 OR p_added_hours > 24
 OR (p_added_hours * 4) <> trunc(p_added_hours * 4)
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid extension parameters'; END IF;

 SELECT * INTO p FROM public.pending_booking_extensions x
 WHERE x.stripe_checkout_session_id=p_checkout_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Registered extension missing'; END IF;
 IF p.booking_id <> p_booking_id OR p.renter_id <> p_renter_id
 OR p.added_hours <> p_added_hours
 OR p.expected_total_cents <> p_expected_total_cents
 OR p.expected_connected_account_id <> p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Trusted extension snapshot mismatch'; END IF;

 SELECT x.listing_id INTO v_listing_id FROM public.bookings x WHERE x.id=p_booking_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Booking missing'; END IF;
 -- Same listing-scoped lock used by create_booking_hold.
 PERFORM pg_catalog.pg_advisory_xact_lock(v_listing_id);
 SELECT * INTO b FROM public.bookings x WHERE x.id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR b.listing_id<>v_listing_id OR b.renter_id<>p_renter_id
 OR b.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Booking identity mismatch'; END IF;

 -- Idempotency is safe: earlier insert and hours update committed together.
 SELECT * INTO e FROM public.booking_extensions x
 WHERE x.stripe_checkout_session_id=p_checkout_session_id;
 IF FOUND THEN
   IF e.booking_id<>p_booking_id
   OR e.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id
   OR e.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
   THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Extension identity conflict'; END IF;
   RETURN QUERY SELECT false,b.hours; RETURN;
 END IF;
 IF b.status <> 'confirmed' OR b.session_range IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Reconcile paid extension manually: booking no longer confirmed'; END IF;

 v_old_end:=upper(b.session_range);
 v_new_end:=v_old_end+(p_added_hours::text||' hours')::interval;
 v_range:=tstzrange(v_old_end,v_new_end,'[)');
 v_spot:=nullif(upper(trim(b.spot_label)),'');
 -- Checkout must already have reserved the EXACT extension interval.
 -- Never trust checkout metadata or a standalone Driver-provided hold ID.
 IF p.hold_id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Registered extension is missing its reserved hold';
 END IF;
 SELECT * INTO v_own_hold FROM public.booking_holds x WHERE x.id=p.hold_id FOR UPDATE;
 IF NOT FOUND OR v_own_hold.listing_id IS DISTINCT FROM v_listing_id
  OR v_own_hold.renter_id IS DISTINCT FROM p_renter_id
  OR v_own_hold.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
  OR v_own_hold.starts_at IS DISTINCT FROM v_old_end
  OR v_own_hold.ends_at IS DISTINCT FROM v_new_end
  OR nullif(upper(trim(v_own_hold.spot_label)),'') IS DISTINCT FROM v_spot
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Registered extension hold does not match booking and Checkout'; END IF;
 SELECT greatest(coalesce(l.spaces,1),1) INTO v_capacity FROM public.listings l WHERE l.id=v_listing_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Listing missing'; END IF;
 SELECT count(*) INTO v_other_bookings FROM public.bookings x
 WHERE x.listing_id=v_listing_id AND x.id<>p_booking_id
 AND x.status='confirmed' AND x.session_range && v_range;
 SELECT count(*) INTO v_other_holds FROM public.booking_holds h
 WHERE h.listing_id=v_listing_id AND h.expires_at>now()
 AND h.id<>p.hold_id
 AND h.starts_at<v_new_end AND h.ends_at>v_old_end;
 IF v_other_bookings+v_other_holds>=v_capacity
 THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Reconcile paid extension manually: capacity conflict'; END IF;
 IF v_spot IS NOT NULL AND (
 EXISTS (SELECT 1 FROM public.bookings x WHERE x.listing_id=v_listing_id
  AND x.id<>p_booking_id AND x.status='confirmed'
  AND upper(trim(x.spot_label))=v_spot AND x.session_range && v_range)
 OR EXISTS (SELECT 1 FROM public.booking_holds h WHERE h.listing_id=v_listing_id
  AND h.id<>p.hold_id AND h.expires_at>now() AND upper(trim(h.spot_label))=v_spot
  AND h.starts_at<v_new_end AND h.ends_at>v_old_end)
 ) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Reconcile paid extension manually: spot conflict'; END IF;

 INSERT INTO public.booking_extensions
 (booking_id,added_hours,added_amount,stripe_checkout_session_id,
  stripe_payment_intent_id,stripe_charge_id,stripe_connected_account_id,status,paid_at)
 VALUES (p_booking_id,p_added_hours,p_expected_total_cents::numeric/100,
 p_checkout_session_id,p_payment_intent_id,p_charge_id,p_connected_account_id,'confirmed',p_paid_at);

 -- Trigger recalculates session_range; existing EXCLUDE constraint rejects
 -- conflicting parking slots. Both writes roll back if either fails.
 UPDATE public.bookings x SET hours=x.hours+p_added_hours
 WHERE x.id=p_booking_id AND x.status='confirmed';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Reconcile paid extension manually: booking changed'; END IF;
 -- Releasing the checkout hold happens in the same atomic transaction as
 -- extending the booking: Stripe replay uses the extension audit row instead.
 DELETE FROM public.booking_holds x WHERE x.id=p.hold_id;
 RETURN QUERY SELECT true,b.hours+p_added_hours;
END;
$func$;

REVOKE ALL ON FUNCTION public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz) TO service_role;



-- Integrated tested proposal 3: bug-005156-property-local-canonical-bookings.sql
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



-- Integrated tested proposal 4: bug-005136-listing-postal-validation.sql
-- BUG-005136: OPTIONAL DATABASE SAFEGUARD — REVIEW ONLY.
-- Do NOT execute on production or active BetterQA QA.
--
-- Today listings.address is a single free-form text field, not a separate
-- postal_code column. New Host form output ends with a normalized A1A 1A1.
-- This trigger enforces a syntactically valid Canadian postal-code suffix
-- for NEW listings and actual address changes only. It does NOT geocode or
-- verify an address/postal pair against Canada Post's postal code database.
--
-- Read-only audit (2026-10-18): 8/14 QA and 3/13 production addresses
-- lack a matching Canadian postal-code suffix. Do not rewrite those rows.
-- Existing unrelated UPDATEs (price, availability, photos) remain allowed.
-- Existing address edits require an address with a valid code before save.
--
-- Migration must be reviewed/approved and created with Supabase CLI. This
-- file is a staged proposal, not a numbered migration to execute.

set local lock_timeout = '5s';

create or replace function public.enforce_listing_postal_format_005136()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  -- An existing historical address should not block a metadata-only edit.
  if TG_OP = 'UPDATE' then
    if NEW.address is not distinct from OLD.address then
      return NEW;
    end if;
  end if;
  if NEW.address is null
     or btrim(NEW.address) !~* '[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$'
  then
    raise exception using
      errcode = '23514',
      message = 'Driveway address must end in a Canadian postal code (A1A 1A1)';
  end if;
  return NEW;
end;
$$;

revoke execute on function public.enforce_listing_postal_format_005136()
  from public, anon, authenticated;

drop trigger if exists listings_postal_format_005136 on public.listings;
create trigger listings_postal_format_005136
before insert or update of address on public.listings
for each row
execute function public.enforce_listing_postal_format_005136();

-- Rollback if approved:
-- drop trigger if exists listings_postal_format_005136 on public.listings;
-- drop function if exists public.enforce_listing_postal_format_005136();



-- Integrated tested proposal 5: bug-005137-hourly-price-constraint.sql
-- BUG-005137 — VALIDATION PROPOSAL ONLY. DO NOT APPLY to active QA/production.
-- Host hourly listing rates must be >= CAD $1.00 and represent whole cents.
-- Deliberately no $200 ceiling: production has historical listings above $200;
-- a product decision/reconciliation is required before imposing that ceiling.
--
-- Before controlled deployment, check:
-- SELECT count(*), min(price), max(price),
--        count(*) FILTER (WHERE price < 1 OR price <> round(price, 2)) AS invalid
-- FROM public.listings;
--
-- Use numbered Supabase migration only after BetterQA approves a controlled
-- QA release and the existing rows have been reviewed.

set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.listings'::regclass
      and conname = 'listings_hourly_price_valid_005137'
  ) then
    alter table public.listings
      add constraint listings_hourly_price_valid_005137
      check (price >= 1 and price = round(price, 2))
      not valid;
  end if;
end
$$;

-- Separate approved step AFTER confirming existing rows comply:
-- alter table public.listings validate constraint listings_hourly_price_valid_005137;



-- Integrated tested proposal 6: bug-005138-future-exceptions.sql
-- BUG-005138 -- REVIEW-ONLY database proposal. DO NOT RUN on active QA
-- or production without BetterQA approval and a coordinated migration.
-- This is not a numbered migration file.
--
-- listings.availability is currently JSONB written directly by the Host UI.
-- The UI guard alone does not stop direct Data API writes that bypass it.
-- This trigger only reviews INSERT and actual availability edits; it never
-- modifies existing exceptions or blocks unrelated edits to legacy listings.
--
-- Release dependency: BUG-005156 (#159) adds the protected time_zone column.
-- Exception dates MUST use that server-approved driveway zone. The timezone
-- string inside Host-editable availability JSON is not authoritative.
-- Missing trusted zones block new/edited exception dates until resolved;
-- empty exceptions and unrelated historical metadata edits remain allowed.
--
-- Before deployment, inspect all existing past exception windows privately.
-- Do not backfill, delete, or rewrite any historical availability data.

set local lock_timeout = '5s';

create or replace function public.reject_past_listing_exceptions_005138()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_zone text;
  v_today date;
  v_exceptions jsonb;
  v_item jsonb;
  v_start text;
  v_end text;
  v_start_date date;
  v_end_date date;
begin
  if TG_OP = 'UPDATE' then
    if NEW.availability is not distinct from OLD.availability then
      return NEW;
    end if;
  end if;

  v_exceptions := NEW.availability -> 'exceptions';
  if v_exceptions is null or jsonb_typeof(v_exceptions) = 'null' then return NEW; end if;
  if jsonb_typeof(v_exceptions) <> 'array' then
    raise exception using errcode='23514', message='Invalid availability exceptions list';
  end if;
  if jsonb_array_length(v_exceptions) = 0 then return NEW; end if;

  v_zone := nullif(NEW.time_zone, '');
  if v_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = v_zone
  ) then
    raise exception using errcode='23514', message='A trusted property timezone is required for availability exceptions';
  end if;
  if nullif(NEW.availability ->> 'timezone', '') is distinct from v_zone then
    raise exception using errcode='23514', message='Availability timezone must match the trusted property timezone';
  end if;
  v_today := (clock_timestamp() at time zone v_zone)::date;

  for v_item in select value from jsonb_array_elements(v_exceptions) as e(value)
  loop
    v_start := v_item ->> 'startDate';
    v_end := v_item ->> 'endDate';
    if v_start is null or v_start !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or v_end is null or v_end !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='23514', message='Availability exception dates must use YYYY-MM-DD';
    end if;
    begin
      v_start_date := v_start::date;
      v_end_date := v_end::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='23514', message='Invalid calendar date in availability exception';
    end;
    if to_char(v_start_date, 'YYYY-MM-DD') <> v_start
       or to_char(v_end_date, 'YYYY-MM-DD') <> v_end
       or v_start_date < v_today
       or v_end_date < v_today
       or v_end_date < v_start_date then
      raise exception using errcode='23514', message='Availability exception must start today or later and end no earlier than its start';
    end if;
  end loop;
  return NEW;
end;
$$;

revoke all on function public.reject_past_listing_exceptions_005138()
  from public, anon, authenticated;

drop trigger if exists listings_no_past_exceptions_005138 on public.listings;
create trigger listings_no_past_exceptions_005138
before insert or update of availability on public.listings
for each row
execute function public.reject_past_listing_exceptions_005138();

-- Reviewed rollback, if authorized:
-- drop trigger if exists listings_no_past_exceptions_005138 on public.listings;
-- drop function if exists public.reject_past_listing_exceptions_005138();



-- Integrated tested proposal 7: qa-verified-reviews.sql
-- DRAFT ONLY. Not executed against BetterQA QA or production.
-- Before rollout: inspect existing duplicate (listing_id,user_id) reviews,
-- resolve legitimate historical reviews, then create a reviewed migration.

SET LOCAL lock_timeout = '5s';
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can leave reviews" ON public.reviews;
-- Both the listing detail and My Bookings forms now use /api/reviews,
-- which validates verified JWT, paid booking, and session end server-side.
REVOKE INSERT ON public.reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.reviews TO service_role;
-- Exactly one review per Driver/listing, including concurrent requests.
-- Requires existing duplicates to be resolved BEFORE deploying.
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_driver_listing
  ON public.reviews(listing_id,user_id);

-- SQL alone is not a safe launch migration without the corresponding
-- application change and a duplicate scan; do not merge independently.



-- Integrated tested proposal 8: bug-005183-restrict-public-data-api.sql
-- BUG-005183 / BUG-005200: REVIEW-ONLY RLS + GRANT change.
-- DO NOT APPLY AUTOMATICALLY.
-- Source: read-only ParkShare-QA policy inspection on October 17, 2026.
-- Not an executable numbered migration; use a controlled Supabase migration
-- after BetterQA approves an integrated API/client/SQL release.
--
-- CAUTION: This intentionally closes DIRECT public Data API reads.
-- Apply only when public-parking / public-reviews and authenticated account
-- routes are live, secure and tested in an ISOLATED environment first.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Listings are viewable by everyone" ON public.listings;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON public.reviews;

-- Existing Host INSERT, UPDATE, DELETE policies remain unchanged.
-- Only the owning Host may directly SELECT raw listing address/coordinates.
DROP POLICY IF EXISTS "Hosts read their private listings" ON public.listings;
CREATE POLICY "Hosts read their private listings" ON public.listings
FOR SELECT TO authenticated
USING (host_id = (SELECT auth.uid()));

-- Authenticated users need ONLY their own profile, including login role.
-- All Host and reviewer names for cross-party views are served by the
-- server-authenticated account/booking API, never via public profile joins.
DROP POLICY IF EXISTS "Members read their own profiles" ON public.profiles;
CREATE POLICY "Members read their own profiles" ON public.profiles
FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()));

-- Permissive SELECT policies combine with OR. Retain a restrictive ownership
-- boundary so an extra broad read policy cannot reopen account enumeration.
DROP POLICY IF EXISTS "Profile reads require ownership" ON public.profiles;
CREATE POLICY "Profile reads require ownership" ON public.profiles
AS RESTRICTIVE FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()));

-- Individual reviewers retain access to their own reviews. Public ratings
-- are exposed only as sanitized summaries via the server endpoint.
DROP POLICY IF EXISTS "Reviewers read their own review rows" ON public.reviews;
CREATE POLICY "Reviewers read their own review rows" ON public.reviews
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

-- Remove inherited/redundant public SELECT grants. Retain authenticated
-- SELECT because Host-owned listings, own profiles, own reviews require it;
-- RLS determines which ROWS are visible to the signed-in user.
REVOKE SELECT ON TABLE public.listings FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.reviews FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.listings TO authenticated;
-- QA has legacy column grants on id/name/role in addition to table grants.
-- Clear column ACLs explicitly before granting only the sign-in projection;
-- include every current column, rather than guessing which old grants exist.
DO $profile_read_columns$
DECLARE columns_sql text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO columns_sql
    FROM pg_attribute
   WHERE attrelid = 'public.profiles'::regclass
     AND attnum > 0 AND NOT attisdropped;
  EXECUTE format(
    'REVOKE SELECT (%s) ON TABLE public.profiles FROM PUBLIC, anon, authenticated',
    columns_sql
  );
END;
$profile_read_columns$;
GRANT SELECT (id, name, role) ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.reviews TO authenticated;

-- Private Storage: PUBLIC bucket metadata currently permits anonymous URL
-- reads bypassing API controls. Existing stored URL strings remain valid as
-- lookup keys, but only the server will be authorized to download the object.
UPDATE storage.buckets SET public = false WHERE id = 'listing-photos';
-- Review any extra storage.objects SELECT policies before applying. Present
-- QA policies allow ONLY the owning Host to SELECT objects.
-- Never grant a blanket anonymous Storage SELECT policy.

-- Never grant service-role privileges to browser/public roles.
-- Service-role stays server-side and bypasses RLS as already configured.

-- REQUIRED after a separate approved deployment:
-- test anon: SELECT raw listings/profiles/reviews via PostgREST must be 403.
-- test signed-in Driver with no booking: listings SELECT must yield no rows.
-- test Host: own listing edit and profile SELECT still function.
-- test signed-in Driver/Host: unfiltered id/name/role reads return own row only.
-- test signed-in user: requesting another profile ID returns no rows.
-- test anon: even explicit id/name/role and count-only queries are denied.
-- test browser: email/Stripe/internal columns remain inaccessible, even own.
-- test Driver with paid booking: exact address through authenticated API ONLY.
-- test Driver with cancelled/unpaid booking: exact address denied.
-- test review posting, reading own row and safe public review summaries.
-- test no leaks via related views/functions/joins/queries/cache.



-- Integrated tested proposal 9: qa-account-deletion-booking-retention.sql
-- REVIEW-ONLY database proposal. DO NOT EXECUTE on ParkShare-QA or production.
-- Account-deletion financial history gap discovered October 18, 2026.
--
-- Confirmed read-only on BOTH environments:
--   bookings.renter_id -> profiles(id) ON DELETE CASCADE
--   listings.host_id  -> profiles(id) ON DELETE CASCADE
--   profiles.id       -> auth.users(id) ON DELETE CASCADE
-- Thus deleting a Driver profile can silently erase their paid/refunded
-- bookings, and deleting a Host profile can erase listings and, on
-- production, associated bookings and extension financial records.
--
-- Fail closed at BOTH profile-facing FKs. A proper account-removal process
-- must instead preserve required transaction records and assess lawful
-- retention/anonymization, Stripe/audit obligations and privacy rights.
-- Explicit product/legal approval REQUIRED before deployment.
--
-- Does NOT repair production bookings.listing_id ON DELETE CASCADE;
-- review existing migration 010 before rollout. Does NOT protect manual
-- direct DELETE FROM bookings; that is a separate authorization/audit task.

SET LOCAL lock_timeout = '5s';

-- Deliberately no IF EXISTS: schema mismatch should fail atomically.
ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_renter_id_fkey;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_renter_id_fkey
  FOREIGN KEY (renter_id) REFERENCES public.profiles(id)
  ON DELETE RESTRICT;

ALTER TABLE public.listings
  DROP CONSTRAINT listings_host_id_fkey;
ALTER TABLE public.listings
  ADD CONSTRAINT listings_host_id_fkey
  FOREIGN KEY (host_id) REFERENCES public.profiles(id)
  ON DELETE RESTRICT;



-- Integrated tested proposal 10: qa-private-messages-rls.sql
-- PROPOSAL ONLY: BUG-005119 — private Host-Driver messages.
-- NOT AN APPLIED MIGRATION. Coordinate separately with BetterQA.
-- QA inspected read-only October 17, 2026: 4 messages, all have recipient_id.
-- Historical production MUST be inventoried before any schema rollout.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- The old policy grants listing-wide read eligibility and includes a
-- self-referential subquery to messages, which can recurse under RLS.
DROP POLICY IF EXISTS "Participants can view messages on a listing they're involved in" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Messages readable only by sender and recipient" ON public.messages;

-- Only the two actual message parties, not everyone who contacted a Host.
CREATE POLICY "Messages readable only by sender and recipient"
ON public.messages FOR SELECT TO authenticated
USING (
  sender_id = (SELECT auth.uid())
  OR recipient_id = (SELECT auth.uid())
);

-- An accidentally broad permissive policy must not reopen other threads.
DROP POLICY IF EXISTS "Message reads require actual participation" ON public.messages;
CREATE POLICY "Message reads require actual participation"
ON public.messages AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  sender_id = (SELECT auth.uid())
  OR recipient_id = (SELECT auth.uid())
);

-- Message creation and recipient selection take place ONLY in the server
-- /api/messages handler, which derives sender ID from the verified JWT and
-- verifies that Host replies target an existing conversation/booking.
REVOKE ALL PRIVILEGES ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages TO service_role;

CREATE INDEX IF NOT EXISTS messages_sender_id_recent_idx
  ON public.messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_recipient_id_recent_idx
  ON public.messages(recipient_id, created_at DESC);

-- BEFORE DEPLOYING this proposal:
-- 1. Read-only inventory of messages with recipient_id IS NULL in QA AND production.
-- 2. Reconcile historical participant identity before access-control cutover.
-- 3. Verify Supabase service_role still has insert/list permissions.
-- 4. Verify authenticated direct POST fails (403), but authenticated
--    API message POST/GET succeeds for appropriate parties.
-- 5. Test anonymous, Driver A, Driver B, Host and unrelated Host via REST.
-- 6. Do not deploy before coordinated BetterQA test window.




-- Verify financial/history rows are byte-equivalent to their pre-release JSON,
-- ignoring ONLY newly added nullable/default audit columns.
DO $preserve$
DECLARE changed bigint;
BEGIN
 SELECT count(*) INTO changed FROM public.bookings b FULL JOIN qa_release_backup_20261019.bookings old ON old.id=b.id
 WHERE b.id IS NULL OR old.id IS NULL OR (to_jsonb(b)-'scheduled_starts_at'-'property_time_zone') IS DISTINCT FROM to_jsonb(old);
 IF changed<>0 THEN RAISE EXCEPTION 'Historical bookings changed during release'; END IF;
END;
$preserve$;
NOTIFY pgrst, 'reload schema';
COMMIT;
