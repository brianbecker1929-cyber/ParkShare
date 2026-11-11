-- ParkShare production candidate; PREPARATION ONLY. No hosted runner is included.
-- Generated from reviewed sources; NEVER run supabase db push from the QA migration directory.
-- A coordinated app/schema cutover, verified backup and scheduler hold remain mandatory.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(20261111,495);
DO $scope$
BEGIN
 IF current_setting('parkshare.migration_scope',true)='isolated-rehearsal' THEN
  IF current_database()<>'parkshare_production_rehearsal' THEN RAISE EXCEPTION 'Dedicated local rehearsal database required'; END IF;
 ELSIF current_setting('parkshare.migration_scope',true)='production-approved' THEN
  IF current_database()<>'postgres' OR current_setting('parkshare.target_project',true) IS DISTINCT FROM 'oyxrussraxjgqwzpwyca'
   OR current_setting('parkshare.backup_restore_verified',true) IS DISTINCT FROM 'yes'
   OR current_setting('parkshare.checkout_and_workers_paused',true) IS DISTINCT FROM 'yes' THEN
   RAISE EXCEPTION 'Production target, restore evidence and cutover controls must be explicitly confirmed'; END IF;
 ELSE RAISE EXCEPTION 'Migration scope is not approved'; END IF;
 IF to_regnamespace('parkshare_private') IS NOT NULL THEN RAISE EXCEPTION 'Private application schema already exists; do not reapply or overwrite newer work'; END IF;
END $scope$;
LOCK TABLE auth.users IN SHARE MODE;
LOCK TABLE storage.buckets,storage.objects IN SHARE MODE;
DO $locks$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
  EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',t.tablename);
 END LOOP;
END $locks$;
DO $baseline$ DECLARE observed text; BEGIN
 SELECT md5(jsonb_build_object(
  'relations', (SELECT jsonb_agg(jsonb_build_array(c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relrowsecurity,c.relforcerowsecurity,(SELECT jsonb_agg(jsonb_build_array(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable) ORDER BY pg_get_userbyid(x.grantee),x.privilege_type) FROM aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x)) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','S')),
  'columns', (SELECT jsonb_agg(jsonb_build_array(c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),(SELECT jsonb_agg(jsonb_build_array(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable) ORDER BY pg_get_userbyid(x.grantee),x.privilege_type) FROM aclexplode(a.attacl) x)) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped),
  'constraints',(SELECT jsonb_agg(jsonb_build_array(c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
  'functions',(SELECT jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),pg_get_functiondef(p.oid),(SELECT jsonb_agg(jsonb_build_array(CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,x.is_grantable) ORDER BY pg_get_userbyid(x.grantee),x.privilege_type) FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) x)) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),
  'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE schemaname='public'),
  'triggers',(SELECT jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
  'indexes',(SELECT jsonb_agg(jsonb_build_array(c.relname,pg_get_indexdef(i.indexrelid)) ORDER BY c.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conindid=i.indexrelid))
)::text) INTO observed;
 IF observed IS DISTINCT FROM 'c88a7b09cb3c4da5b99628cfe6d6a3a6' THEN RAISE EXCEPTION 'Production schema drifted; recapture, review and rehearse before proceeding'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage') OR EXISTS(SELECT 1 FROM storage.buckets)
  OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='storage.objects'::regclass) THEN
  RAISE EXCEPTION 'Storage baseline changed; review bucket and object policy boundaries before migration'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_holds WHERE expires_at>now()) THEN RAISE EXCEPTION 'Active checkout holds remain'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_holds WHERE stripe_checkout_session_id IS NOT NULL)
  AND current_setting('parkshare.retained_checkouts_reviewed',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Retained Checkout sessions require Stripe reconciliation before cutover'; END IF;
END $baseline$;
CREATE TEMP TABLE production_preservation_guard(table_name text PRIMARY KEY,columns text[] NOT NULL,n bigint NOT NULL,digest text NOT NULL) ON COMMIT DROP;
DO $capture$ DECLARE t record; cols text[]; n bigint; digest text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
  SELECT array_agg(attname::text ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid=format('public.%I',t.tablename)::regclass AND attnum>0 AND NOT attisdropped;
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(to_jsonb(s)::text,''|'' ORDER BY to_jsonb(s)::text),'''')) FROM public.%I s',t.tablename) INTO n,digest;
  INSERT INTO production_preservation_guard VALUES(t.tablename,cols,n,digest);
 END LOOP;
END $capture$;
-- Source 1: supabase-migration-010-preserve-bookings-on-listing-delete.sql
alter table public.bookings
  drop constraint if exists bookings_listing_id_fkey;
alter table public.bookings
  add constraint bookings_listing_id_fkey
  foreign key (listing_id) references public.listings (id)
  on delete restrict;

alter table public.booking_holds
  drop constraint if exists booking_holds_listing_id_fkey;
alter table public.booking_holds
  add constraint booking_holds_listing_id_fkey
  foreign key (listing_id) references public.listings (id)
  on delete restrict;

-- Source 2: supabase-migration-011-registered-checkouts.sql
alter table public.booking_holds
  add column if not exists expected_total_cents integer,
  add column if not exists expected_connected_account_id text,
  add column if not exists checkout_metadata jsonb;

alter table public.booking_holds
  add constraint booking_holds_expected_total_positive
  check (expected_total_cents is null or expected_total_cents >= 50);

create table if not exists public.pending_booking_extensions (
  id uuid primary key default gen_random_uuid(),
  booking_id bigint not null references public.bookings(id) on delete restrict,
  renter_id uuid not null references auth.users(id) on delete restrict,
  added_hours numeric not null check (added_hours > 0 and added_hours <= 24),
  expected_total_cents integer not null check (expected_total_cents >= 50),
  expected_service_fee_cents integer not null check (expected_service_fee_cents >= 0),
  expected_connected_account_id text not null,
  stripe_checkout_session_id text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists pending_booking_extensions_booking_id_idx
  on public.pending_booking_extensions (booking_id);

alter table public.pending_booking_extensions enable row level security;
revoke all on public.pending_booking_extensions from public, anon, authenticated;
grant select, insert, update, delete on public.pending_booking_extensions to service_role;

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

  perform pg_advisory_xact_lock(p_listing_id);

  select greatest(coalesce(spaces, 1), 1)
    into v_capacity
  from public.listings
  where id = p_listing_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Listing not found';
  end if;

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

  return v_hold_id;
end;
$$;

-- Source 3: supabase-migration-012-host-role-listings-rls.sql
drop policy if exists "Hosts can insert their own listings" on public.listings;
drop policy if exists "Hosts can update their own listings" on public.listings;
drop policy if exists "Hosts can delete their own listings" on public.listings;

create policy "Hosts can insert their own listings"
on public.listings
for insert to authenticated
with check (
  host_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

create policy "Hosts can update their own listings"
on public.listings
for update to authenticated
using (
  host_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
)
with check (
  host_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

create policy "Hosts can delete their own listings"
on public.listings
for delete to authenticated
using (
  host_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

-- Source 4: supabase-migration-013-listing-photos-storage.sql
insert into storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types)
values
  ('listing-photos', 'listing-photos', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "ParkShare Host upload own listing photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

create policy "ParkShare Host inspect own listing photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

create policy "ParkShare Host remove own listing photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'listing-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

-- Source 5: docs/sql-proposals/bug-005118-unpaid-hold-rate-limits.sql
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

  insert into public.booking_hold_attempts (renter_id, hold_id)
    values (p_renter_id, v_hold_id);

  return v_hold_id;
end;
$$;


revoke all on function public.create_booking_hold(bigint, uuid, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_booking_hold(bigint, uuid, text, timestamptz, timestamptz, timestamptz)
  to service_role;

-- Source 6: docs/sql-proposals/qa-atomic-extensions-and-refunds.sql
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
 PERFORM pg_catalog.pg_advisory_xact_lock(v_listing_id);
 SELECT * INTO b FROM public.bookings x WHERE x.id=p_booking_id FOR UPDATE;
 IF NOT FOUND OR b.listing_id<>v_listing_id OR b.renter_id<>p_renter_id
 OR b.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Booking identity mismatch'; END IF;

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

 UPDATE public.bookings x SET hours=x.hours+p_added_hours
 WHERE x.id=p_booking_id AND x.status='confirmed';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Reconcile paid extension manually: booking changed'; END IF;
 DELETE FROM public.booking_holds x WHERE x.id=p.hold_id;
 RETURN QUERY SELECT true,b.hours+p_added_hours;
END;
$func$;

REVOKE ALL ON FUNCTION public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz) TO service_role;

-- Source 7: docs/sql-proposals/bug-005156-property-local-canonical-bookings.sql
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS time_zone text;
ALTER TABLE public.listings
  ADD CONSTRAINT listings_time_zone_max_length
  CHECK (time_zone IS NULL OR length(time_zone) BETWEEN 3 AND 100);

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

-- Source 8: docs/sql-proposals/bug-005136-listing-postal-validation.sql
create or replace function public.enforce_listing_postal_format_005136()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
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

-- Source 9: docs/sql-proposals/bug-005137-hourly-price-constraint.sql
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

-- Source 10: docs/sql-proposals/bug-005138-future-exceptions.sql
create or replace function public.reject_past_listing_exceptions_005138()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_zone text;
  v_today date;
  v_latest date;
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
  v_latest := (v_today + interval '12 months')::date;

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
    if v_start_date > v_latest or v_end_date > v_latest then
      raise exception using errcode='23514', message='Special dates must be within 12 calendar months of today';
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

-- Source 11: docs/sql-proposals/qa-verified-reviews.sql
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can leave reviews" ON public.reviews;
REVOKE INSERT ON public.reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.reviews TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_driver_listing
  ON public.reviews(listing_id,user_id);

-- Source 12: docs/sql-proposals/bug-005183-restrict-public-data-api.sql
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Listings are viewable by everyone" ON public.listings;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON public.reviews;

DROP POLICY IF EXISTS "Hosts read their private listings" ON public.listings;
CREATE POLICY "Hosts read their private listings" ON public.listings
FOR SELECT TO authenticated
USING (host_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Members read their own profiles" ON public.profiles;
CREATE POLICY "Members read their own profiles" ON public.profiles
FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Profile reads require ownership" ON public.profiles;
CREATE POLICY "Profile reads require ownership" ON public.profiles
AS RESTRICTIVE FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Reviewers read their own review rows" ON public.reviews;
CREATE POLICY "Reviewers read their own review rows" ON public.reviews
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

REVOKE SELECT ON TABLE public.listings FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.reviews FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.listings TO authenticated;
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

UPDATE storage.buckets SET public = false WHERE id = 'listing-photos';

-- Source 13: docs/sql-proposals/qa-account-deletion-booking-retention.sql
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

-- Source 14: docs/sql-proposals/qa-private-messages-rls.sql
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view messages on a listing they're involved in" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Messages readable only by sender and recipient" ON public.messages;

CREATE POLICY "Messages readable only by sender and recipient"
ON public.messages FOR SELECT TO authenticated
USING (
  sender_id = (SELECT auth.uid())
  OR recipient_id = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "Message reads require actual participation" ON public.messages;
CREATE POLICY "Message reads require actual participation"
ON public.messages AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  sender_id = (SELECT auth.uid())
  OR recipient_id = (SELECT auth.uid())
);

REVOKE ALL PRIVILEGES ON TABLE public.messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages TO service_role;

CREATE INDEX IF NOT EXISTS messages_sender_id_recent_idx
  ON public.messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_recipient_id_recent_idx
  ON public.messages(recipient_id, created_at DESC);

-- Source 15: supabase/migrations/20261019164722_listing_photo_cleanup_005187.sql
CREATE SCHEMA IF NOT EXISTS parkshare_private;
REVOKE ALL ON SCHEMA parkshare_private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.listing_photo_cleanup (
  object_path text PRIMARY KEY,
  host_id uuid NOT NULL,
  listing_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_photo_cleanup_owned_path CHECK (
    object_path ~ ('^' || host_id::text || '/[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\.(jpg|png|webp)$')
  )
);
CREATE INDEX listing_photo_cleanup_due ON public.listing_photo_cleanup(next_attempt_at);
ALTER TABLE public.listing_photo_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_photo_cleanup FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.listing_photo_cleanup TO service_role;

CREATE FUNCTION parkshare_private.queue_deleted_listing_photos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE photo text; object_key text;
BEGIN
  IF TG_OP <> 'DELETE' OR TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'listings' THEN
    RAISE EXCEPTION 'Unsupported photo cleanup trigger';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> OLD.host_id THEN
    RAISE EXCEPTION 'Listing owner required' USING ERRCODE = '42501';
  END IF;
  FOR photo IN
    SELECT DISTINCT value FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(OLD.photos) = 'array' THEN OLD.photos ELSE '[]'::jsonb END
      || jsonb_build_array(OLD.img)
    ) AS p(value)
  LOOP
    object_key := regexp_replace(split_part(photo, '?', 1),
      '^https://[^/]+/storage/v1/object/(public|sign|authenticated)/listing-photos/', '');
    IF object_key ~ ('^' || OLD.host_id::text || '/[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\.(jpg|png|webp)$') THEN
      INSERT INTO public.listing_photo_cleanup(object_path, host_id, listing_id)
      VALUES(object_key, OLD.host_id, OLD.id)
      ON CONFLICT(object_path) DO UPDATE SET listing_id = EXCLUDED.listing_id, next_attempt_at = now();
    END IF;
  END LOOP;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION parkshare_private.queue_deleted_listing_photos() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER queue_deleted_listing_photos AFTER DELETE ON public.listings
FOR EACH ROW EXECUTE FUNCTION parkshare_private.queue_deleted_listing_photos();

CREATE FUNCTION public.listing_photo_cleanup_batch(target_listing_id bigint DEFAULT NULL, batch_limit integer DEFAULT 50)
RETURNS TABLE(object_path text, host_id uuid)
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT q.object_path, q.host_id FROM public.listing_photo_cleanup AS q
  WHERE q.next_attempt_at <= now()
    AND (target_listing_id IS NULL OR q.listing_id = target_listing_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.listings AS l,
        LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(l.photos) = 'array' THEN l.photos ELSE '[]'::jsonb END
          || jsonb_build_array(l.img)
        ) AS p(value)
      WHERE regexp_replace(split_part(p.value, '?', 1),
        '^https://[^/]+/storage/v1/object/(public|sign|authenticated)/listing-photos/', '') = q.object_path
    )
  ORDER BY q.next_attempt_at, q.object_path
  LIMIT least(greatest(coalesce(batch_limit, 50), 1), 50);
$$;
REVOKE ALL ON FUNCTION public.listing_photo_cleanup_batch(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listing_photo_cleanup_batch(bigint, integer) TO service_role;

-- Source 16: supabase/migrations/20261019182335_multiple_refund_ledger_005188.sql
LOCK TABLE public.bookings,public.booking_extensions IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE refund_migration_guard ON COMMIT DROP AS SELECT
 (SELECT md5(string_agg(to_jsonb(b)::text,',' ORDER BY b.id)) FROM public.bookings b) bookings_digest,
 (SELECT md5(string_agg(to_jsonb(e)::text,',' ORDER BY e.id)) FROM public.booking_extensions e) extensions_digest;
ALTER TABLE public.bookings
 ADD COLUMN refund_total_amount numeric CHECK(refund_total_amount>=0),
 ADD COLUMN refund_pending_amount numeric CHECK(refund_pending_amount>=0),
 ADD COLUMN refund_ledger_revision bigint NOT NULL DEFAULT 0 CHECK(refund_ledger_revision>=0),
 ADD COLUMN refund_reconciled_at timestamptz;
ALTER TABLE public.booking_extensions
 ADD COLUMN refund_total_amount numeric CHECK(refund_total_amount>=0),
 ADD COLUMN refund_pending_amount numeric CHECK(refund_pending_amount>=0),
 ADD COLUMN refund_ledger_revision bigint NOT NULL DEFAULT 0 CHECK(refund_ledger_revision>=0);

CREATE TABLE public.payment_refunds (
 connected_account_id text NOT NULL CHECK(connected_account_id ~ '^acct_[A-Za-z0-9_]+$'),
 livemode boolean NOT NULL,
 refund_id text NOT NULL CHECK(refund_id ~ '^re_[A-Za-z0-9_]+$'),
 booking_id bigint REFERENCES public.bookings(id) ON DELETE RESTRICT,
 extension_id bigint REFERENCES public.booking_extensions(id) ON DELETE RESTRICT,
 payment_intent_id text NOT NULL CHECK(payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
 charge_id text NOT NULL CHECK(charge_id ~ '^ch_[A-Za-z0-9_]+$'),
 currency text NOT NULL CHECK(currency='cad'),
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 status text NOT NULL CHECK(status IN ('pending','requires_action','succeeded','failed','canceled')),
 failure_reason text,
 stripe_created_at timestamptz NOT NULL,
 source_event_id text NOT NULL CHECK(source_event_id ~ '^evt_[A-Za-z0-9_]+$'),
 reconciled_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(connected_account_id,livemode,refund_id),
 CHECK(num_nonnulls(booking_id,extension_id)=1)
);
CREATE INDEX payment_refunds_booking_idx ON public.payment_refunds(booking_id);
CREATE INDEX payment_refunds_extension_idx ON public.payment_refunds(extension_id);
CREATE INDEX payment_refunds_payment_idx ON public.payment_refunds(connected_account_id,livemode,payment_intent_id);
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_refunds FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.payment_refunds TO service_role;

CREATE SCHEMA IF NOT EXISTS parkshare_private;
REVOKE ALL ON SCHEMA parkshare_private FROM PUBLIC,anon,authenticated;
CREATE FUNCTION parkshare_private.refund_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.refund_ledger_revision=OLD.refund_ledger_revision AND
    (to_jsonb(NEW)-ARRAY['refund_ledger_revision','refund_reconciled_at','hours','session_range']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['refund_ledger_revision','refund_reconciled_at','hours','session_range']) THEN
   NEW.refund_ledger_revision=OLD.refund_ledger_revision+1;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION parkshare_private.refund_revision_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER bookings_refund_revision BEFORE UPDATE ON public.bookings
 FOR EACH ROW EXECUTE FUNCTION parkshare_private.refund_revision_guard();
CREATE TRIGGER extensions_refund_revision BEFORE UPDATE ON public.booking_extensions
 FOR EACH ROW EXECUTE FUNCTION parkshare_private.refund_revision_guard();

CREATE FUNCTION public.reconcile_payment_refunds(
 p_kind text,p_record_id bigint,p_account text,p_payment_intent text,p_charge text,
 p_livemode boolean,p_expected_revision bigint,p_event_id text,p_gross_cents bigint,
 p_charge_refunded_cents bigint,p_refunds jsonb,p_disputed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 owner_row record; original_id text; legacy record; settled bigint; pending bigint;
 gross numeric; affected integer; owner_count integer;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('booking','extension') OR p_record_id IS NULL OR
    p_account IS NULL OR p_account !~ '^acct_[A-Za-z0-9_]+$' OR
    p_payment_intent IS NULL OR p_payment_intent !~ '^pi_[A-Za-z0-9_]+$' OR
    p_charge IS NULL OR p_charge !~ '^ch_[A-Za-z0-9_]+$' OR p_livemode IS NULL OR
    p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]+$' OR
    p_expected_revision IS NULL OR p_expected_revision<0 OR p_gross_cents IS NULL OR p_gross_cents<=0 OR
    p_charge_refunded_cents IS NULL OR p_charge_refunded_cents<0 OR p_disputed IS NULL OR
    jsonb_typeof(p_refunds) IS DISTINCT FROM 'array' OR jsonb_array_length(p_refunds) NOT BETWEEN 1 AND 10000 THEN
   RAISE EXCEPTION 'Invalid refund snapshot' USING ERRCODE='22023';
 END IF;
 IF p_kind='booking' THEN
   SELECT b.id,b.total amount,b.paid_at,b.stripe_charge_id,b.stripe_refund_id,b.refund_ledger_revision
    INTO owner_row FROM public.bookings b WHERE b.id=p_record_id AND b.stripe_connected_account_id=p_account
      AND b.stripe_payment_intent_id=p_payment_intent FOR UPDATE;
 ELSE
   SELECT e.id,e.added_amount amount,e.paid_at,e.stripe_charge_id,e.stripe_refund_id,e.refund_ledger_revision
    INTO owner_row FROM public.booking_extensions e WHERE e.id=p_record_id AND e.stripe_connected_account_id=p_account
      AND e.stripe_payment_intent_id=p_payment_intent FOR UPDATE;
 END IF;
 IF NOT FOUND OR owner_row.paid_at IS NULL OR
    (owner_row.stripe_charge_id IS NOT NULL AND owner_row.stripe_charge_id<>p_charge) THEN
   RAISE EXCEPTION 'Refund payment owner mismatch' USING ERRCODE='22023';
 END IF;
 IF owner_row.refund_ledger_revision<>p_expected_revision THEN
   RAISE EXCEPTION 'Refund snapshot changed concurrently; retrieve and retry' USING ERRCODE='40001';
 END IF;
 SELECT (SELECT count(*) FROM public.bookings b WHERE b.stripe_connected_account_id=p_account AND b.stripe_payment_intent_id=p_payment_intent)
      + (SELECT count(*) FROM public.booking_extensions e WHERE e.stripe_connected_account_id=p_account AND e.stripe_payment_intent_id=p_payment_intent)
 INTO owner_count;
 IF owner_count<>1 THEN RAISE EXCEPTION 'Ambiguous refund payment owner' USING ERRCODE='22023'; END IF;
 gross=owner_row.amount*100;
 IF gross<>p_gross_cents OR gross<>trunc(gross) THEN
   RAISE EXCEPTION 'Refund charge amount mismatch' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_refunds) AS r(refund_id text,amount_cents bigint,status text,created bigint)
    WHERE r.refund_id IS NULL OR r.refund_id !~ '^re_[A-Za-z0-9_]+$' OR r.amount_cents IS NULL OR r.amount_cents<=0 OR r.amount_cents>gross
       OR r.status IS NULL OR r.status NOT IN ('pending','requires_action','succeeded','failed','canceled') OR r.created IS NULL OR r.created<=0)
    OR (SELECT count(DISTINCT r->>'refund_id') FROM jsonb_array_elements(p_refunds) r)<>jsonb_array_length(p_refunds) THEN
   RAISE EXCEPTION 'Invalid individual refund' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(sum(r.amount_cents) FILTER(WHERE r.status='succeeded'),0),
        coalesce(sum(r.amount_cents) FILTER(WHERE r.status IN ('pending','requires_action')),0)
 INTO settled,pending FROM jsonb_to_recordset(p_refunds) AS r(amount_cents bigint,status text);
 IF settled+pending>gross OR p_charge_refunded_cents<settled OR p_charge_refunded_cents>settled+pending THEN
   RAISE EXCEPTION 'Incomplete or inconsistent refund totals' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM public.payment_refunds f
   WHERE (p_kind='booking' AND f.booking_id=p_record_id OR p_kind='extension' AND f.extension_id=p_record_id)
     AND (f.connected_account_id<>p_account OR f.livemode<>p_livemode OR f.payment_intent_id<>p_payment_intent OR f.charge_id<>p_charge
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_refunds) r WHERE r->>'refund_id'=f.refund_id)))
    OR owner_row.stripe_refund_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_refunds) r WHERE r->>'refund_id'=owner_row.stripe_refund_id) THEN
   RAISE EXCEPTION 'Existing refund missing or changed identity' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.payment_refunds AS f(connected_account_id,livemode,refund_id,booking_id,extension_id,
   payment_intent_id,charge_id,currency,amount_cents,status,failure_reason,stripe_created_at,source_event_id)
 SELECT p_account,p_livemode,r.refund_id,CASE WHEN p_kind='booking' THEN p_record_id END,
   CASE WHEN p_kind='extension' THEN p_record_id END,p_payment_intent,p_charge,'cad',r.amount_cents,r.status,
   left(r.failure_reason,200),to_timestamp(r.created),p_event_id
 FROM jsonb_to_recordset(p_refunds) AS r(refund_id text,amount_cents bigint,status text,failure_reason text,created bigint)
 ON CONFLICT(connected_account_id,livemode,refund_id) DO UPDATE SET
   status=excluded.status,failure_reason=excluded.failure_reason,source_event_id=excluded.source_event_id,reconciled_at=now()
 WHERE f.booking_id IS NOT DISTINCT FROM excluded.booking_id AND f.extension_id IS NOT DISTINCT FROM excluded.extension_id
   AND f.payment_intent_id=excluded.payment_intent_id AND f.charge_id=excluded.charge_id
   AND f.amount_cents=excluded.amount_cents AND f.stripe_created_at=excluded.stripe_created_at;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>jsonb_array_length(p_refunds) THEN
   RAISE EXCEPTION 'Immutable refund identity changed' USING ERRCODE='22023';
 END IF;
 original_id=owner_row.stripe_refund_id;
 SELECT r.* INTO legacy FROM jsonb_to_recordset(p_refunds) AS r(refund_id text,amount_cents bigint,status text,failure_reason text,created bigint)
 WHERE original_id IS NULL OR r.refund_id=original_id ORDER BY r.created,r.refund_id LIMIT 1;
 IF p_kind='booking' THEN
   UPDATE public.bookings b SET
    refund_total_amount=settled::numeric/100,refund_pending_amount=pending::numeric/100,
    refund_ledger_revision=p_expected_revision+1,refund_reconciled_at=now(),
    stripe_refund_id=legacy.refund_id,refund_amount=legacy.amount_cents::numeric/100,
    refund_status=legacy.status,refund_failure_reason=left(legacy.failure_reason,200),
    status=CASE WHEN b.status='disputed' OR p_disputed THEN 'disputed'
                WHEN b.status IN ('refunded','cancelled','canceled') THEN b.status
                WHEN settled=gross THEN 'refunded'
                WHEN b.status='partially_refunded' THEN 'confirmed' ELSE b.status END,
    cancelled_at=CASE WHEN settled=gross AND b.status<>'disputed' AND NOT p_disputed THEN coalesce(b.cancelled_at,now()) ELSE b.cancelled_at END
   WHERE b.id=p_record_id;
 ELSE
   UPDATE public.booking_extensions e SET
    refund_total_amount=settled::numeric/100,refund_pending_amount=pending::numeric/100,
    refund_ledger_revision=p_expected_revision+1,refund_reconciled_at=now(),
    stripe_refund_id=legacy.refund_id,refund_amount=legacy.amount_cents::numeric/100,
    refund_status=legacy.status,refund_failure_reason=left(legacy.failure_reason,200),
    charge_amount_refunded=settled::numeric/100,charge_fully_refunded=settled=gross,charge_disputed=e.charge_disputed OR p_disputed
   WHERE e.id=p_record_id;
 END IF;
 RETURN jsonb_build_object('applied',true,'revision',p_expected_revision+1,'settledCents',settled,'pendingCents',pending);
END $$;
REVOKE ALL ON FUNCTION public.reconcile_payment_refunds(text,bigint,text,text,text,boolean,bigint,text,bigint,bigint,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_payment_refunds(text,bigint,text,text,text,boolean,bigint,text,bigint,bigint,jsonb,boolean) TO service_role;
DO $$
DECLARE before_row record; booking_after text; extension_after text;
BEGIN
 SELECT * INTO before_row FROM pg_temp.refund_migration_guard;
 SELECT md5(string_agg((to_jsonb(b)-ARRAY['refund_total_amount','refund_pending_amount','refund_ledger_revision','refund_reconciled_at'])::text,',' ORDER BY b.id))
 INTO booking_after FROM public.bookings b;
 SELECT md5(string_agg((to_jsonb(e)-ARRAY['refund_total_amount','refund_pending_amount','refund_ledger_revision'])::text,',' ORDER BY e.id))
 INTO extension_after FROM public.booking_extensions e;
 IF booking_after IS DISTINCT FROM before_row.bookings_digest OR extension_after IS DISTINCT FROM before_row.extensions_digest THEN
  RAISE EXCEPTION 'Refund migration changed existing payment data';
 END IF;
END $$;

-- Source 17: supabase/migrations/20261019192851_bounded_public_parking_005220.sql
CREATE OR REPLACE FUNCTION public.public_parking_page(p_before_id bigint DEFAULT NULL)
RETURNS TABLE(id bigint,price numeric,spaces integer,lat double precision,lng double precision,
  spots jsonb,time_zone text,rating numeric,review_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH page AS MATERIALIZED (
    SELECT l.id,l.price,l.spaces,l.lat,l.lng,l.spots,l.time_zone
    FROM public.listings l
    WHERE p_before_id IS NULL OR l.id < p_before_id
    ORDER BY l.id DESC LIMIT 51
  )
  SELECT p.id,p.price,p.spaces,
    round(p.lat::numeric,2)::double precision,round(p.lng::numeric,2)::double precision,
    coalesce((SELECT jsonb_agg(jsonb_build_object('forRent',s.value->'forRent' = 'true'::jsonb) ORDER BY s.ordinality)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.spots)='array' THEN p.spots ELSE '[]'::jsonb END)
        WITH ORDINALITY s(value,ordinality) WHERE s.ordinality <= 8),'[]'::jsonb),
    p.time_zone,r.rating,r.review_count
  FROM page p
  CROSS JOIN LATERAL (SELECT coalesce(avg(v.rating),0) rating,count(*) review_count
    FROM public.reviews v WHERE v.listing_id=p.id AND v.rating BETWEEN 1 AND 5) r
  ORDER BY p.id DESC;
$$;
REVOKE ALL ON FUNCTION public.public_parking_page(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.public_parking_page(bigint) TO service_role;

-- Source 18: supabase/migrations/20261019203117_listing_timezone_assignment.sql
CREATE OR REPLACE FUNCTION public.listings_enforce_trusted_time_zone()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Publish through the ParkShare Host listing service to verify the property time zone';
    END IF;
    IF NEW.time_zone IS DISTINCT FROM OLD.time_zone
      OR NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng
      OR NEW.address IS DISTINCT FROM OLD.address THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Property location and time zone changes require server verification';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.listing_timezone_assignment_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT position('Publish through the ParkShare Host listing service' IN pg_catalog.pg_get_functiondef('public.listings_enforce_trusted_time_zone()'::regprocedure)) > 0
    AND position('Property location and time zone changes require server verification' IN pg_catalog.pg_get_functiondef('public.listings_enforce_trusted_time_zone()'::regprocedure)) > 0;
$$;
REVOKE ALL ON FUNCTION public.listing_timezone_assignment_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.listing_timezone_assignment_ready() TO service_role;

-- Source 19: supabase/migrations/20261019221450_listing_publication_retries.sql
CREATE TABLE parkshare_private.listing_publications (
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  listing_id bigint UNIQUE,
  time_zone text,
  rejection text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (host_id,request_id),
  CHECK ((listing_id IS NOT NULL AND time_zone IS NOT NULL AND rejection IS NULL)
    OR (listing_id IS NULL AND time_zone IS NULL AND rejection IS NOT NULL))
);
ALTER TABLE parkshare_private.listing_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parkshare_private.listing_publications FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA parkshare_private TO service_role;
GRANT SELECT,INSERT ON parkshare_private.listing_publications TO service_role;

CREATE FUNCTION public.publish_host_listing(
  p_host_id uuid,p_request_id uuid,p_payload_hash text,
  p_listing jsonb DEFAULT NULL,p_rejection text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  previous parkshare_private.listing_publications%ROWTYPE;
  saved public.listings%ROWTYPE;
  candidate public.listings%ROWTYPE;
BEGIN
  IF p_host_id IS NULL OR p_request_id IS NULL OR p_payload_hash IS NULL
    OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid publication identity';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_host_id AND role='host') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only Hosts can publish listings';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_host_id::text||':'||p_request_id::text,0));
  SELECT * INTO previous FROM parkshare_private.listing_publications
    WHERE host_id=p_host_id AND request_id=p_request_id;
  IF FOUND THEN
    IF previous.payload_hash<>p_payload_hash THEN
      RAISE EXCEPTION USING ERRCODE='P0061',MESSAGE='Publication payload changed';
    END IF;
    IF previous.rejection IS NOT NULL THEN
      RETURN jsonb_build_object('rejected',true,'error',previous.rejection);
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.listings WHERE id=previous.listing_id AND host_id=p_host_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0062',MESSAGE='Published listing was deleted';
    END IF;
    RETURN jsonb_build_object('id',previous.listing_id,'timeZone',previous.time_zone,'replayed',true);
  END IF;
  IF p_rejection IS NOT NULL THEN
    IF p_listing IS NOT NULL OR length(p_rejection)>500 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid publication rejection';
    END IF;
    INSERT INTO parkshare_private.listing_publications(host_id,request_id,payload_hash,rejection)
      VALUES(p_host_id,p_request_id,p_payload_hash,p_rejection);
    RETURN jsonb_build_object('rejected',true,'error',p_rejection);
  END IF;
  IF p_listing IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO candidate FROM jsonb_populate_record(NULL::public.listings,p_listing);
  IF candidate.host_id IS DISTINCT FROM p_host_id OR candidate.time_zone IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid server publication';
  END IF;
  INSERT INTO public.listings(host_id,title,address,price,description,features,spaces,photos,img,spots,availability,lat,lng,time_zone)
    VALUES(p_host_id,candidate.title,candidate.address,candidate.price,candidate.description,candidate.features,
      candidate.spaces,candidate.photos,candidate.img,candidate.spots,candidate.availability,candidate.lat,candidate.lng,candidate.time_zone)
    RETURNING * INTO saved;
  INSERT INTO parkshare_private.listing_publications(host_id,request_id,payload_hash,listing_id,time_zone)
    VALUES(p_host_id,p_request_id,p_payload_hash,saved.id,saved.time_zone);
  RETURN jsonb_build_object('id',saved.id,'timeZone',saved.time_zone,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_host_listing(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_host_listing(uuid,uuid,text,jsonb,text) TO service_role;

CREATE FUNCTION public.listing_publication_ready() RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT to_regclass('parkshare_private.listing_publications') IS NOT NULL
    AND to_regprocedure('public.publish_host_listing(uuid,uuid,text,jsonb,text)') IS NOT NULL
    AND NOT has_function_privilege('anon','public.publish_host_listing(uuid,uuid,text,jsonb,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.publish_host_listing(uuid,uuid,text,jsonb,text)','EXECUTE');
$$;
REVOKE ALL ON FUNCTION public.listing_publication_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.listing_publication_ready() TO service_role;

-- Source 20: supabase/migrations/20261020205407_extension_settlement_005116_005260.sql
ALTER TABLE public.booking_extensions ADD COLUMN application_state text NOT NULL DEFAULT 'applied'
 CHECK (application_state IN ('applied','rejected'));

CREATE FUNCTION public.record_rejected_booking_extension(
 p_checkout_session_id text, p_payment_intent_id text, p_charge_id text,
 p_connected_account_id text, p_gross_cents integer, p_paid_at timestamptz
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $func$
DECLARE
 p public.pending_booking_extensions%ROWTYPE;
 b public.bookings%ROWTYPE;
 e public.booking_extensions%ROWTYPE;
 h public.booking_holds%ROWTYPE;
 listing bigint;
BEGIN
 IF p_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
 OR p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$' OR p_charge_id !~ '^ch_[A-Za-z0-9_]+$'
 OR p_connected_account_id !~ '^acct_[A-Za-z0-9_]+$'
 OR p_gross_cents IS NULL OR p_gross_cents<=0 OR p_paid_at IS NULL
 OR p_checkout_session_id IS NULL OR p_payment_intent_id IS NULL
 OR p_charge_id IS NULL OR p_connected_account_id IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid rejected extension payment'; END IF;
 SELECT * INTO p FROM public.pending_booking_extensions x
 WHERE x.stripe_checkout_session_id=p_checkout_session_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Registered extension missing'; END IF;
 IF p.expected_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension account mismatch'; END IF;
 SELECT x.listing_id INTO listing FROM public.bookings x WHERE x.id=p.booking_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Booking missing'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(listing);
 SELECT * INTO b FROM public.bookings x WHERE x.id=p.booking_id FOR UPDATE;
 IF NOT FOUND OR b.listing_id IS DISTINCT FROM listing OR b.renter_id IS DISTINCT FROM p.renter_id
 OR b.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension booking mismatch'; END IF;
 SELECT * INTO e FROM public.booking_extensions x WHERE x.stripe_checkout_session_id=p_checkout_session_id;
 IF FOUND THEN
  IF e.application_state<>'rejected' OR e.booking_id IS DISTINCT FROM p.booking_id
   OR e.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id
   OR e.stripe_charge_id IS DISTINCT FROM p_charge_id
   OR e.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
   OR e.added_amount IS DISTINCT FROM p_gross_cents::numeric/100
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension already applied or payment identity changed'; END IF;
 ELSE
  INSERT INTO public.booking_extensions(booking_id,added_hours,added_amount,stripe_checkout_session_id,
   stripe_payment_intent_id,stripe_charge_id,stripe_connected_account_id,status,paid_at,application_state)
  VALUES(p.booking_id,p.added_hours,p_gross_cents::numeric/100,p_checkout_session_id,
   p_payment_intent_id,p_charge_id,p_connected_account_id,'payment_failed',p_paid_at,'rejected') RETURNING * INTO e;
 END IF;
 SELECT * INTO h FROM public.booking_holds x WHERE x.id=p.hold_id FOR UPDATE;
 IF FOUND THEN
  IF h.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
   OR h.listing_id IS DISTINCT FROM b.listing_id OR h.renter_id IS DISTINCT FROM p.renter_id
   OR h.ends_at-h.starts_at IS DISTINCT FROM (p.added_hours::text||' hours')::interval
   OR nullif(upper(trim(h.spot_label)),'') IS DISTINCT FROM nullif(upper(trim(b.spot_label)),'')
   OR (h.expected_connected_account_id IS NOT NULL AND h.expected_connected_account_id<>p_connected_account_id)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension hold mismatch'; END IF;
  DELETE FROM public.booking_holds x WHERE x.id=h.id AND x.stripe_checkout_session_id=p_checkout_session_id;
 END IF;
 RETURN e.id;
END;
$func$;
REVOKE ALL ON FUNCTION public.record_rejected_booking_extension(text,text,text,text,integer,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_rejected_booking_extension(text,text,text,text,integer,timestamptz) TO service_role;

CREATE FUNCTION public.release_unpaid_extension_checkout(p_checkout_session_id text,p_connected_account_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $func$
DECLARE
 p public.pending_booking_extensions%ROWTYPE;
 b public.bookings%ROWTYPE;
 h public.booking_holds%ROWTYPE;
 listing bigint;
BEGIN
 SELECT * INTO p FROM public.pending_booking_extensions x
 WHERE x.stripe_checkout_session_id=p_checkout_session_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p.expected_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension account mismatch'; END IF;
 SELECT x.listing_id INTO listing FROM public.bookings x WHERE x.id=p.booking_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Booking missing'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(listing);
 SELECT * INTO b FROM public.bookings x WHERE x.id=p.booking_id FOR UPDATE;
 IF NOT FOUND OR b.listing_id IS DISTINCT FROM listing OR b.renter_id IS DISTINCT FROM p.renter_id
 OR b.stripe_connected_account_id IS DISTINCT FROM p_connected_account_id
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension booking mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.booking_extensions x WHERE x.stripe_checkout_session_id=p_checkout_session_id)
 THEN RETURN false; END IF;
 SELECT * INTO h FROM public.booking_holds x WHERE x.id=p.hold_id FOR UPDATE;
 IF FOUND THEN
  IF h.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id
   OR h.listing_id IS DISTINCT FROM b.listing_id OR h.renter_id IS DISTINCT FROM p.renter_id
   OR (h.expected_connected_account_id IS NOT NULL AND h.expected_connected_account_id<>p_connected_account_id)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Extension hold mismatch'; END IF;
  DELETE FROM public.booking_holds x WHERE x.id=h.id AND x.stripe_checkout_session_id=p_checkout_session_id;
 END IF;
 DELETE FROM public.pending_booking_extensions x WHERE x.id=p.id AND x.expected_connected_account_id=p_connected_account_id;
 RETURN true;
END;
$func$;
REVOKE ALL ON FUNCTION public.release_unpaid_extension_checkout(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_unpaid_extension_checkout(text,text) TO service_role;
NOTIFY pgrst,'reload schema';

-- Source 21: supabase/migrations/20261021103527_booking_reminder_delivery_005226_005261.sql
create table public.booking_reminder_deliveries (
  id text primary key,
  booking_id bigint not null references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('halfway', 'ending')),
  session_ends_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  lease_until timestamptz not null default '-infinity',
  provider_id text,
  sent_at timestamptz,
  unique (booking_id, kind),
  check ((sent_at is null) = (provider_id is null))
);
alter table public.booking_reminder_deliveries enable row level security;
revoke all on public.booking_reminder_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.booking_reminder_deliveries to service_role;
comment on table public.booking_reminder_deliveries is
  'Server-only frozen email payloads; 2-minute leases and Resend idempotency prevent duplicate reminders. Never retry unaccepted deliveries after 23 hours.';

-- Source 22: supabase/migrations/20261021111213_refund_notifications_005249.sql
create table parkshare_private.refund_notification_rollout (
  singleton boolean primary key default true check(singleton),
  enabled_at timestamptz not null default date_trunc('second',clock_timestamp())
);
insert into parkshare_private.refund_notification_rollout(singleton) values(true);
alter table parkshare_private.refund_notification_rollout enable row level security;
revoke all on parkshare_private.refund_notification_rollout from public,anon,authenticated;
grant usage on schema parkshare_private to service_role;
grant select on parkshare_private.refund_notification_rollout to service_role;
create policy refund_rollout_worker on parkshare_private.refund_notification_rollout
  for select to service_role using(true);

create table public.refund_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  connected_account_id text not null,
  livemode boolean not null,
  refund_id text not null,
  booking_id bigint not null references public.bookings(id) on delete restrict,
  audience text not null check(audience in ('driver','host')),
  created_at timestamptz not null default now(),
  payload jsonb check(payload is null or jsonb_typeof(payload)='object'),
  first_attempt_at timestamptz,
  lease_until timestamptz not null default '-infinity',
  provider_id text,
  sent_at timestamptz,
  blocked_at timestamptz,
  unique(connected_account_id,livemode,refund_id,audience),
  foreign key(connected_account_id,livemode,refund_id)
    references public.payment_refunds(connected_account_id,livemode,refund_id) on delete restrict,
  check((sent_at is null)=(provider_id is null)),
  check((payload is null)=(first_attempt_at is null))
);
create index refund_email_booking_idx on public.refund_email_deliveries(booking_id);
create index refund_email_pending_idx on public.refund_email_deliveries(lease_until,created_at)
  where sent_at is null and blocked_at is null;
alter table public.refund_email_deliveries enable row level security;
revoke all on public.refund_email_deliveries from public,anon,authenticated;
grant select,insert,update on public.refund_email_deliveries to service_role;
create policy refund_email_worker on public.refund_email_deliveries
  for all to service_role using(true) with check(true);

create function parkshare_private.queue_refund_emails() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent_id bigint; enabled_at timestamptz;
begin
  if new.status<>'succeeded' then return new; end if;
  if tg_op='UPDATE' and old.status='succeeded' then return new; end if;
  select r.enabled_at into strict enabled_at
    from parkshare_private.refund_notification_rollout r where r.singleton;
  if tg_op='INSERT' and new.stripe_created_at < enabled_at then return new; end if;
  parent_id=new.booking_id;
  if parent_id is null then
    select e.booking_id into strict parent_id from public.booking_extensions e where e.id=new.extension_id;
  end if;
  insert into public.refund_email_deliveries(connected_account_id,livemode,refund_id,booking_id,audience)
    values(new.connected_account_id,new.livemode,new.refund_id,parent_id,'driver'),
          (new.connected_account_id,new.livemode,new.refund_id,parent_id,'host')
    on conflict(connected_account_id,livemode,refund_id,audience) do nothing;
  return new;
end $$;
revoke all on function parkshare_private.queue_refund_emails() from public,anon,authenticated;
grant execute on function parkshare_private.queue_refund_emails() to service_role;
create trigger queue_verified_refund_emails after insert or update of status
  on public.payment_refunds for each row execute function parkshare_private.queue_refund_emails();
comment on table public.refund_email_deliveries is
  'Service-only refund notifications, one Driver and Host receipt per successful verified refund. Frozen payloads and provider IDs support safe retries.';

-- Source 23: supabase/migrations/20261021200835_exception_horizon_005138.sql
do $$
begin
  if to_regprocedure('public.reject_past_listing_exceptions_005138()') is null
     or not exists (select 1 from pg_trigger where tgrelid='public.listings'::regclass and tgname='listings_no_past_exceptions_005138' and not tgisinternal) then
    raise exception 'Existing BUG-005138 exception guard is required';
  end if;
end;
$$;

create or replace function public.reject_past_listing_exceptions_005138()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_zone text;
  v_today date;
  v_latest date;
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
  v_latest := (v_today + interval '12 months')::date;

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
    if v_start_date > v_latest or v_end_date > v_latest then
      raise exception using errcode='23514', message='Special dates must be within 12 calendar months of today';
    end if;
  end loop;
  return NEW;
end;
$$;

revoke all on function public.reject_past_listing_exceptions_005138()
  from public, anon, authenticated;

-- Source 24: supabase/migrations/20261021210715_initial_booking_refund_history.sql
LOCK TABLE public.bookings IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE initial_booking_preservation ON COMMIT DROP AS
 SELECT count(*) AS n,md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id)::text,'[]')) AS digest
 FROM public.bookings b;
ALTER TABLE public.bookings
 ADD COLUMN application_state text NOT NULL DEFAULT 'applied' CHECK(application_state IN ('applied','rejected')),
 ADD COLUMN checkout_rejection_reason text CHECK(checkout_rejection_reason IN ('booking_conflict','payment_reversed')),
 ADD CONSTRAINT bookings_rejected_checkout_no_entitlement CHECK(application_state<>'rejected' OR status NOT IN ('confirmed','completed'));

CREATE FUNCTION public.settle_initial_booking_checkout(p_hold_id uuid,p_booking jsonb,p_payment_reversed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $func$
DECLARE
 b public.bookings%ROWTYPE;
 existing public.bookings%ROWTYPE;
 h public.booking_holds%ROWTYPE;
 listing bigint;
 capacity integer;
 host uuid;
 starts timestamptz;
 intended tstzrange;
 rejected boolean:=false;
 reason text;
BEGIN
 IF jsonb_typeof(p_booking) IS DISTINCT FROM 'object' OR p_payment_reversed IS NULL OR p_hold_id IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid checkout settlement'; END IF;
 b:=jsonb_populate_record(NULL::public.bookings,p_booking);
 IF b.id IS NOT NULL OR b.listing_id IS NULL OR b.renter_id IS NULL OR b.paid_at IS NULL
 OR b.stripe_checkout_session_id IS NULL OR b.stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
 OR b.stripe_payment_intent_id IS NULL OR b.stripe_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
 OR b.stripe_charge_id IS NULL OR b.stripe_charge_id !~ '^ch_[A-Za-z0-9_]+$'
 OR b.stripe_connected_account_id IS NULL OR b.stripe_connected_account_id !~ '^acct_[A-Za-z0-9_]+$'
 OR b.total IS NULL OR b.total<0.5 OR b.subtotal IS NULL OR b.service_fee IS NULL
 OR b.subtotal<0 OR b.service_fee<0 OR b.total<>b.subtotal+b.service_fee
 OR b.total*100<>trunc(b.total*100) OR b.subtotal*100<>trunc(b.subtotal*100) OR b.service_fee*100<>trunc(b.service_fee*100)
 OR b.hours IS NULL OR b.hours<=0 OR b.hours>24 OR b.hours*4<>trunc(b.hours*4)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid registered booking payment'; END IF;
 SELECT x.listing_id INTO listing FROM public.booking_holds x WHERE x.id=p_hold_id;
 listing:=coalesce(listing,b.listing_id);
 PERFORM pg_catalog.pg_advisory_xact_lock(listing);
 SELECT * INTO existing FROM public.bookings x WHERE x.stripe_checkout_session_id=b.stripe_checkout_session_id;
 IF FOUND THEN
  IF existing.listing_id IS DISTINCT FROM b.listing_id OR existing.renter_id IS DISTINCT FROM b.renter_id
   OR existing.stripe_payment_intent_id IS DISTINCT FROM b.stripe_payment_intent_id
   OR existing.stripe_charge_id IS DISTINCT FROM b.stripe_charge_id
   OR existing.stripe_connected_account_id IS DISTINCT FROM b.stripe_connected_account_id
   OR existing.total IS DISTINCT FROM b.total
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Checkout payment identity changed'; END IF;
  RETURN jsonb_build_object('applied',false,'refund_required',existing.application_state='rejected','booking',to_jsonb(existing));
 END IF;
 SELECT * INTO h FROM public.booking_holds x WHERE x.id=p_hold_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Registered booking hold missing'; END IF;
 IF h.listing_id IS DISTINCT FROM listing OR h.listing_id IS DISTINCT FROM b.listing_id
 OR h.renter_id IS DISTINCT FROM b.renter_id
 OR h.stripe_checkout_session_id IS DISTINCT FROM b.stripe_checkout_session_id
 OR h.expected_connected_account_id IS DISTINCT FROM b.stripe_connected_account_id
 OR h.expected_total_cents IS DISTINCT FROM (b.total*100)::integer
 OR h.checkout_metadata IS NULL
 OR (h.checkout_metadata->>'hold_id') IS DISTINCT FROM h.id::text
 OR (h.checkout_metadata->>'listing_id') IS DISTINCT FROM b.listing_id::text
 OR (h.checkout_metadata->>'renter_id') IS DISTINCT FROM b.renter_id::text
 OR (h.checkout_metadata->>'connected_account_id') IS DISTINCT FROM b.stripe_connected_account_id
 OR (h.checkout_metadata->>'total_cents')::numeric IS DISTINCT FROM b.total*100
 OR (h.checkout_metadata->>'subtotal_cents')::numeric IS DISTINCT FROM b.subtotal*100
 OR (h.checkout_metadata->>'service_fee_cents')::numeric IS DISTINCT FROM b.service_fee*100
 OR (h.checkout_metadata->>'hours')::numeric IS DISTINCT FROM b.hours
 OR h.ends_at-h.starts_at IS DISTINCT FROM (b.hours::text||' hours')::interval
 OR nullif(upper(trim(h.spot_label)),'') IS DISTINCT FROM nullif(upper(trim(b.spot_label)),'')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Registered booking hold snapshot mismatch'; END IF;
 SELECT greatest(coalesce(l.spaces,1),1),l.host_id INTO capacity,host FROM public.listings l WHERE l.id=listing;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Listing missing'; END IF;
 IF h.checkout_metadata->>'host_id' IS DISTINCT FROM host::text
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Booking Host changed'; END IF;
 IF b.scheduled_starts_at IS NOT NULL AND b.scheduled_starts_at IS DISTINCT FROM h.starts_at
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Scheduled booking differs from held instant'; END IF;
 starts:=coalesce(b.scheduled_starts_at,CASE WHEN b.booking_date IS NOT NULL AND b.start_hour IS NOT NULL
  THEN (b.booking_date::date+(b.start_hour::text||' hours')::interval) AT TIME ZONE 'UTC' ELSE b.paid_at END);
 intended:=tstzrange(starts,starts+(b.hours::text||' hours')::interval,'[)');
 rejected:=p_payment_reversed;
 IF rejected THEN reason:='payment_reversed'; END IF;
 IF NOT rejected AND (
   (SELECT count(*) FROM public.bookings x WHERE x.listing_id=listing AND x.status='confirmed' AND x.session_range && intended)
   +(SELECT count(*) FROM public.booking_holds x WHERE x.listing_id=listing AND x.id<>h.id AND x.expires_at>now()
     AND x.starts_at<upper(intended) AND x.ends_at>lower(intended))>=capacity
   OR nullif(trim(b.spot_label),'') IS NOT NULL AND (
    EXISTS(SELECT 1 FROM public.bookings x WHERE x.listing_id=listing AND x.status='confirmed'
     AND upper(trim(x.spot_label))=upper(trim(b.spot_label)) AND x.session_range && intended)
    OR EXISTS(SELECT 1 FROM public.booking_holds x WHERE x.listing_id=listing AND x.id<>h.id AND x.expires_at>now()
     AND upper(trim(x.spot_label))=upper(trim(b.spot_label)) AND x.starts_at<upper(intended) AND x.ends_at>lower(intended))
   )) THEN rejected:=true; reason:='booking_conflict'; END IF;
 LOOP
  BEGIN
   INSERT INTO public.bookings(
    listing_id,renter_id,hours,total,subtotal,service_fee,status,stripe_checkout_session_id,
    stripe_payment_intent_id,stripe_charge_id,stripe_connected_account_id,spot_label,
    booking_date,scheduled_starts_at,property_time_zone,start_hour,end_hour,
    vehicle_profile_id,vehicle_type,vehicle_make,vehicle_model,vehicle_colour,license_plate,
    event_id,event_name,event_category,event_venue_name,event_address,event_lat,event_lng,
    event_starts_at,event_ends_at,event_timezone,event_source,event_source_url,event_access_notes,event_closure_notice,
    paid_at,application_state,checkout_rejection_reason)
   VALUES(b.listing_id,b.renter_id,b.hours,b.total,b.subtotal,b.service_fee,
    CASE WHEN rejected THEN 'payment_failed' ELSE 'confirmed' END,b.stripe_checkout_session_id,
    b.stripe_payment_intent_id,b.stripe_charge_id,b.stripe_connected_account_id,b.spot_label,
    b.booking_date,b.scheduled_starts_at,b.property_time_zone,b.start_hour,b.end_hour,
    b.vehicle_profile_id,b.vehicle_type,b.vehicle_make,b.vehicle_model,b.vehicle_colour,b.license_plate,
    b.event_id,b.event_name,b.event_category,b.event_venue_name,b.event_address,b.event_lat,b.event_lng,
    b.event_starts_at,b.event_ends_at,b.event_timezone,b.event_source,b.event_source_url,b.event_access_notes,b.event_closure_notice,
    b.paid_at,CASE WHEN rejected THEN 'rejected' ELSE 'applied' END,reason) RETURNING * INTO b;
   EXIT;
  EXCEPTION WHEN exclusion_violation THEN
   IF rejected THEN RAISE; END IF;
   rejected:=true; reason:='booking_conflict';
  END;
 END LOOP;
 DELETE FROM public.booking_holds x WHERE x.id=h.id AND x.stripe_checkout_session_id=b.stripe_checkout_session_id;
 RETURN jsonb_build_object('applied',NOT rejected,'refund_required',rejected,'booking',to_jsonb(b));
END;
$func$;
REVOKE ALL ON FUNCTION public.settle_initial_booking_checkout(uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_initial_booking_checkout(uuid,jsonb,boolean) TO service_role;
DO $preserve$
DECLARE v_count bigint; v_digest text;
BEGIN
 SELECT count(*),md5(coalesce(jsonb_agg(to_jsonb(b)-'application_state'-'checkout_rejection_reason' ORDER BY b.id)::text,'[]'))
 INTO v_count,v_digest FROM public.bookings b;
 IF NOT EXISTS(SELECT 1 FROM pg_temp.initial_booking_preservation p WHERE p.n=v_count AND p.digest=v_digest)
 THEN RAISE EXCEPTION 'Original booking data changed during settlement migration'; END IF;
END;
$preserve$;
NOTIFY pgrst,'reload schema';

-- Source 25: supabase/migrations/20261025152330_deduplicate_extension_spot_capacity_005324.sql
DO $migration$
DECLARE
 definition text;
 old_expression text := $old$  select
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
    into v_taken;$old$;
 new_expression text := $new$  select count(*) into v_taken from (
    select coalesce('spot:' || nullif(upper(trim(b.spot_label)), ''), 'booking:' || b.id::text) as inventory_key
    from public.bookings b
    where b.listing_id = p_listing_id and b.status = 'confirmed'
      and b.session_range && tstzrange(p_starts_at, p_ends_at, '[)')
    union
    select coalesce('spot:' || nullif(upper(trim(h.spot_label)), ''), 'hold:' || h.id::text)
    from public.booking_holds h
    where h.listing_id = p_listing_id and h.expires_at > now()
      and h.starts_at < p_ends_at and p_starts_at < h.ends_at
  ) occupied_spots;$new$;
BEGIN
 SELECT pg_get_functiondef('public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)'::regprocedure) INTO definition;
 IF strpos(definition, old_expression) = 0 THEN
  RAISE EXCEPTION 'Unexpected create_booking_hold definition; review before migration';
 END IF;
 EXECUTE replace(definition, old_expression, new_expression);

 old_expression := $old$ SELECT count(*) INTO v_other_bookings FROM public.bookings x
 WHERE x.listing_id=v_listing_id AND x.id<>p_booking_id
 AND x.status='confirmed' AND x.session_range && v_range;
 SELECT count(*) INTO v_other_holds FROM public.booking_holds h
 WHERE h.listing_id=v_listing_id AND h.expires_at>now()
 AND h.id<>p.hold_id
 AND h.starts_at<v_new_end AND h.ends_at>v_old_end;$old$;
 new_expression := $new$ SELECT count(*) INTO v_other_bookings FROM (
  SELECT coalesce('spot:' || nullif(upper(trim(x.spot_label)), ''), 'booking:' || x.id::text) AS inventory_key
  FROM public.bookings x WHERE x.listing_id=v_listing_id AND x.id<>p_booking_id
   AND x.status='confirmed' AND x.session_range && v_range
  UNION
  SELECT coalesce('spot:' || nullif(upper(trim(h.spot_label)), ''), 'hold:' || h.id::text)
  FROM public.booking_holds h WHERE h.listing_id=v_listing_id AND h.expires_at>now()
   AND h.id<>p.hold_id AND h.starts_at<v_new_end AND h.ends_at>v_old_end
 ) occupied_spots;
 v_other_holds := 0;$new$;
 SELECT pg_get_functiondef('public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz)'::regprocedure) INTO definition;
 IF strpos(definition, old_expression) = 0 THEN
  RAISE EXCEPTION 'Unexpected apply_paid_booking_extension definition; review before migration';
 END IF;
 EXECUTE replace(definition, old_expression, new_expression);
END;
$migration$;
NOTIFY pgrst, 'reload schema';

-- Source 26: supabase/migrations/20261031185643_webhook_refund_conflict_005158.sql
DO $migration$
DECLARE
  target regprocedure := to_regprocedure('public.reconcile_payment_refunds(text,bigint,text,text,text,boolean,bigint,text,bigint,bigint,jsonb,boolean)');
  definition text;
  previous record;
  updated record;
  old_clause constant text := $old$RAISE EXCEPTION 'Refund snapshot changed concurrently; retrieve and retry' USING ERRCODE='40001';$old$;
  new_clause constant text := $new$RAISE EXCEPTION 'Refund snapshot changed concurrently; retrieve and retry' USING ERRCODE='PT409', DETAIL='refund_snapshot_stale';$new$;
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Refund reconciliation function is missing'; END IF;
  SELECT proacl, prosecdef, proconfig, proowner INTO previous FROM pg_proc WHERE oid=target;
  IF previous.prosecdef THEN RAISE EXCEPTION 'Expected invoker-only refund reconciliation'; END IF;
  definition := pg_get_functiondef(target);
  IF strpos(definition,new_clause)>0 AND strpos(definition,old_clause)=0 THEN RETURN; END IF;
  IF (length(definition)-length(replace(definition,old_clause,'')))/length(old_clause) <> 1 THEN
    RAISE EXCEPTION 'Refund reconciliation definition changed; review before applying';
  END IF;
  EXECUTE replace(definition,old_clause,new_clause);
  SELECT proacl, prosecdef, proconfig, proowner INTO updated FROM pg_proc WHERE oid=target;
  IF previous IS DISTINCT FROM updated THEN
    RAISE EXCEPTION 'Refund reconciliation permissions/configuration changed';
  END IF;
END
$migration$;

-- Source 27: supabase/migrations/20261031191201_checkout_rate_limit_recovery_005462.sql
DO $migration$
DECLARE
  target regprocedure := to_regprocedure('public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)');
  definition text;
  previous record;
  updated record;
  old_clause constant text := $old$  if (
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
  end if;$old$;
  new_clause constant text := $new$  declare
    v_retry_at timestamptz;
    v_bound timestamptz;
    v_reason text;
    v_limits text[] := '{}';
  begin
    select h.expires_at into v_bound from public.booking_holds h
      where h.renter_id = p_renter_id and h.expires_at > now()
      order by h.expires_at desc offset 1 limit 1;
    if v_bound is not null then
      v_retry_at := v_bound;
      v_reason := 'active_checkouts';
      v_limits := array_append(v_limits, v_reason);
    end if;
    select a.created_at + interval '2 hours' into v_bound
      from public.booking_hold_attempts a
      where a.renter_id = p_renter_id and a.created_at > now() - interval '2 hours'
      order by a.created_at desc offset 3 limit 1;
    if v_bound is not null then
      v_limits := array_append(v_limits, 'two_hour_limit');
      if v_retry_at is null or v_bound > v_retry_at then
        v_retry_at := v_bound; v_reason := 'two_hour_limit';
      end if;
    end if;
    select a.created_at + interval '24 hours' into v_bound
      from public.booking_hold_attempts a
      where a.renter_id = p_renter_id and a.created_at > now() - interval '24 hours'
      order by a.created_at desc offset 11 limit 1;
    if v_bound is not null then
      v_limits := array_append(v_limits, 'daily_limit');
      if v_retry_at is null or v_bound > v_retry_at then
        v_retry_at := v_bound; v_reason := 'daily_limit';
      end if;
    end if;
    if v_retry_at is not null then
      raise exception using errcode = 'P0058', message = 'Parking checkout limit reached',
        detail = jsonb_build_object('version', 1, 'reason', v_reason,
          'limits', v_limits, 'retry_at', v_retry_at)::text;
    end if;
  end;$new$;
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Booking hold function is missing'; END IF;
  SELECT proacl, prosecdef, proconfig, proowner INTO previous FROM pg_proc WHERE oid=target;
  definition := pg_get_functiondef(target);
  IF strpos(definition,new_clause)>0 AND strpos(definition,old_clause)=0 THEN RETURN; END IF;
  IF (length(definition)-length(replace(definition,old_clause,'')))/length(old_clause) <> 1 THEN
    RAISE EXCEPTION 'Booking hold quota definition changed; review before applying';
  END IF;
  EXECUTE replace(definition,old_clause,new_clause);
  SELECT proacl, prosecdef, proconfig, proowner INTO updated FROM pg_proc WHERE oid=target;
  IF previous IS DISTINCT FROM updated THEN
    RAISE EXCEPTION 'Booking hold permissions/configuration changed';
  END IF;
END
$migration$;

-- Source 28: supabase/migrations/20261101195507_qa_listing_pause_005445.sql
alter table public.listings add column if not exists is_paused boolean not null default false;
create schema if not exists parkshare_private;
create or replace function parkshare_private.reject_paused_listing_hold_005445()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_paused boolean;
begin
  select l.is_paused into v_paused from public.listings l
    where l.id = new.listing_id for share;
  if v_paused is true then
    raise exception using errcode = 'P0063', message = 'This listing is paused and is not accepting new bookings.';
  end if;
  return new;
end;
$$;
revoke all on function parkshare_private.reject_paused_listing_hold_005445() from public, anon, authenticated;
grant execute on function parkshare_private.reject_paused_listing_hold_005445() to service_role;
drop trigger if exists booking_holds_listing_not_paused_005445 on public.booking_holds;
create trigger booking_holds_listing_not_paused_005445
before insert on public.booking_holds for each row
execute function parkshare_private.reject_paused_listing_hold_005445();

-- Source 29: supabase/migrations/20261101225651_qa_booking_vehicle_type_005157.sql
alter table public.bookings drop constraint if exists bookings_vehicle_type_check;
alter table public.bookings add constraint bookings_vehicle_type_check check (
  vehicle_type is null or vehicle_type in ('primary','guest','sedan','suv','coupe','hatchback','pickup','van')
);
comment on column public.bookings.vehicle_type is 'Saved vehicle body class for new checkouts; NULL when unspecified. Historical primary/guest values predate BUG-005157.';
comment on column public.bookings.confirmation_email_sent_at is 'Provider acceptance time of the Driver booking confirmation; not inbox delivery or Host notification status.';

-- Source 30: supabase/migrations/20261111033631_cancellation_reason_fee_policy.sql
create table public.booking_refund_operations (
 id uuid primary key default gen_random_uuid(), booking_id bigint not null references public.bookings(id),
 request_key text not null, requested_by uuid not null, actor text not null check(actor in ('driver','host','staff')),
 action text not null check(action in ('cancel','refund')), reason_code text not null, explanation text not null,
 fee_payer text not null check(fee_payer in ('host','parkshare')),
 connected_account_id text not null, payment_intent_id text not null, charge_id text not null, livemode boolean not null,
 currency text not null default 'cad' check(currency='cad'), gross_cents bigint not null check(gross_cents>0),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=gross_cents),
 processing_fee_cents bigint not null check(processing_fee_cents>=0 and processing_fee_cents<=gross_cents),
 fee_credit_cents bigint check(fee_credit_cents>=0 and fee_credit_cents<=processing_fee_cents),
 refund_id text, refund_status text, transfer_id text,
 state text not null default 'queued' check(state in ('queued','complete','review')),
 created_at timestamptz not null default now(), refund_attempt_at timestamptz, transfer_attempt_at timestamptz,
 lease_until timestamptz not null default now(), lease_token uuid, review_code text,
 unique(booking_id,request_key), unique(connected_account_id,livemode,refund_id), unique(transfer_id)
);
alter table public.booking_refund_operations enable row level security;
revoke all on public.booking_refund_operations from public,anon,authenticated;
grant select,insert,update on public.booking_refund_operations to service_role;
create index booking_refund_operations_pending on public.booking_refund_operations(livemode,lease_until) where state='queued';

create table public.booking_cancellation_reviews (
 id uuid primary key default gen_random_uuid(), booking_id bigint not null references public.bookings(id),
 requested_by uuid not null, reason_code text not null check(reason_code='driver_access'),
 explanation text not null, created_at timestamptz not null default now(),
 unique(booking_id,requested_by)
);
alter table public.booking_cancellation_reviews enable row level security;
revoke all on public.booking_cancellation_reviews from public,anon,authenticated;
grant select,insert on public.booking_cancellation_reviews to service_role;

create function public.reserve_booking_refund(p_operation jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.bookings%rowtype; existing public.booking_refund_operations%rowtype; op public.booking_refund_operations%rowtype;
begin
 select * into strict b from public.bookings where id=(p_operation->>'booking_id')::bigint for update;
 select * into existing from public.booking_refund_operations where booking_id=b.id and request_key=p_operation->>'request_key';
 if found then return to_jsonb(existing); end if;
 if b.status not in ('confirmed','completed') or b.paid_at is null
 or b.stripe_charge_id is distinct from p_operation->>'charge_id'
 or b.stripe_payment_intent_id is distinct from p_operation->>'payment_intent_id'
 or b.stripe_connected_account_id is distinct from p_operation->>'connected_account_id'
 or round(b.total*100)<>(p_operation->>'gross_cents')::bigint
 or coalesce(b.refund_pending_amount,0)>0
 or (p_operation->>'amount_cents')::bigint>round((b.total-coalesce(b.refund_total_amount,0))*100)
 then raise exception 'booking_payment_changed'; end if;
 if exists(select 1 from public.booking_refund_operations where booking_id=b.id and state<>'complete'
 and coalesce(refund_status,'') not in ('failed','canceled')) then raise exception 'refund_operation_pending_review'; end if;
 insert into public.booking_refund_operations(booking_id,request_key,requested_by,actor,action,reason_code,explanation,fee_payer,
 connected_account_id,payment_intent_id,charge_id,livemode,gross_cents,amount_cents,processing_fee_cents)
 values(b.id,p_operation->>'request_key',(p_operation->>'requested_by')::uuid,p_operation->>'actor',p_operation->>'action',
 p_operation->>'reason_code',p_operation->>'explanation',p_operation->>'fee_payer',p_operation->>'connected_account_id',
 p_operation->>'payment_intent_id',p_operation->>'charge_id',(p_operation->>'livemode')::boolean,
 (p_operation->>'gross_cents')::bigint,(p_operation->>'amount_cents')::bigint,(p_operation->>'processing_fee_cents')::bigint) returning * into op;
 if op.action='cancel' then
 update public.bookings set cancellation_requested_at=now(),cancelled_by=case when op.actor='staff' then 'support' else op.actor end,
 cancellation_reason=op.reason_code||case when op.explanation<>'' then ': '||op.explanation else '' end where id=b.id;
 end if;
 return to_jsonb(op);
end $$;

create function public.claim_booking_refund(p_id uuid,p_token uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare op public.booking_refund_operations%rowtype;
begin
 update public.booking_refund_operations set lease_token=p_token,lease_until=now()+interval '2 minutes',
 refund_attempt_at=coalesce(refund_attempt_at,now())
 where id=p_id and state='queued' and lease_until<=now() returning * into op;
 return case when found then to_jsonb(op) else null end;
end $$;

create function public.allocate_refund_fee_credit(p_id uuid,p_token uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare op public.booking_refund_operations%rowtype; eligible bigint; credited bigint; target bigint;
begin
 perform 1 from public.bookings where id=(select booking_id from public.booking_refund_operations where id=p_id) for update;
 select * into strict op from public.booking_refund_operations where id=p_id and lease_token=p_token for update;
 if op.refund_status is distinct from 'succeeded' then raise exception 'refund_not_succeeded'; end if;
 if op.fee_credit_cents is not null then return to_jsonb(op); end if;
 if op.fee_payer='host' then target:=0;
 else
 select coalesce(sum(amount_cents),0),coalesce(sum(fee_credit_cents),0) into eligible,credited
 from public.booking_refund_operations where connected_account_id=op.connected_account_id and livemode=op.livemode
 and charge_id=op.charge_id and id<>op.id and fee_payer='parkshare' and fee_credit_cents is not null;
 target:=greatest(0,least(op.processing_fee_cents,round(op.processing_fee_cents::numeric*least(op.gross_cents,eligible+op.amount_cents)/op.gross_cents)::bigint)-credited);
 end if;
 update public.booking_refund_operations set fee_credit_cents=target where id=op.id returning * into op;
 return to_jsonb(op);
end $$;
revoke all on function public.reserve_booking_refund(jsonb),public.claim_booking_refund(uuid,uuid),public.allocate_refund_fee_credit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_booking_refund(jsonb),public.claim_booking_refund(uuid,uuid),public.allocate_refund_fee_credit(uuid,uuid) to service_role;

-- Source 31: docs/sql-proposals/qa-message-notifications-005536.sql
create schema if not exists parkshare_private;
create table public.message_email_deliveries (
  message_id bigint primary key references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  payload jsonb check(payload is null or jsonb_typeof(payload)='object'),
  first_attempt_at timestamptz,
  lease_until timestamptz not null default '-infinity',
  provider_id text,
  sent_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text,
  check((sent_at is null)=(provider_id is null)),
  check((payload is null)=(first_attempt_at is null))
);
create index message_email_pending_idx on public.message_email_deliveries(lease_until,message_id)
  where sent_at is null and blocked_at is null;
alter table public.message_email_deliveries enable row level security;
revoke all on public.message_email_deliveries from public,anon,authenticated;
grant select,insert,update on public.message_email_deliveries to service_role;
create policy message_email_worker on public.message_email_deliveries
  for all to service_role using(true) with check(true);

create function parkshare_private.queue_message_email() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.recipient_id is not null and new.recipient_id<>new.sender_id then
    insert into public.message_email_deliveries(message_id) values(new.id);
  end if;
  return new;
end;
$$;
revoke all on function parkshare_private.queue_message_email() from public,anon,authenticated;
grant usage on schema parkshare_private to service_role;
grant execute on function parkshare_private.queue_message_email() to service_role;
create trigger queue_new_message_email after insert on public.messages
  for each row execute function parkshare_private.queue_message_email();

-- Every original column/value and original row count must survive all stages.
DO $preserve$ DECLARE t record; after_n bigint; after_digest text; BEGIN
 FOR t IN SELECT * FROM production_preservation_guard ORDER BY table_name LOOP
  EXECUTE format('SELECT count(*),md5(coalesce(string_agg(row::text,''|'' ORDER BY row::text),'''')) FROM (SELECT (SELECT jsonb_object_agg(k,v) FROM jsonb_each(to_jsonb(s)) j(k,v) WHERE k=ANY($1)) row FROM public.%I s) x',t.table_name) INTO after_n,after_digest USING t.columns;
  IF after_n<>t.n OR after_digest IS DISTINCT FROM t.digest THEN RAISE EXCEPTION 'Historical data changed in %; transaction refused',t.table_name; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.booking_refund_operations) OR EXISTS(SELECT 1 FROM public.booking_cancellation_reviews)
  OR EXISTS(SELECT 1 FROM public.payment_refunds) OR EXISTS(SELECT 1 FROM public.booking_reminder_deliveries)
  OR EXISTS(SELECT 1 FROM public.refund_email_deliveries) OR EXISTS(SELECT 1 FROM public.message_email_deliveries)
  OR EXISTS(SELECT 1 FROM public.listing_photo_cleanup) THEN RAISE EXCEPTION 'Migration must not create historical notifications, money jobs or deletions'; END IF;
END $preserve$;
CREATE TABLE parkshare_private.production_release_versions (
 package_id text PRIMARY KEY,source_commit text NOT NULL,inputs_sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE parkshare_private.production_release_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parkshare_private.production_release_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON parkshare_private.production_release_versions TO service_role;
INSERT INTO parkshare_private.production_release_versions(package_id,source_commit,inputs_sha256)
 VALUES('production-candidate-2026-11-11','62ffb4b65de72ace10d5bd9454b54ad6786c57e3','d2ffd9bebdaee2bb3b62025da27060343b91d992fdf4f64e6b670dc8c0ba1f5d');
NOTIFY pgrst,'reload schema';
COMMIT;
