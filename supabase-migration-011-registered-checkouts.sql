-- BUG-005114: bind payment confirmations to checkout intents created
-- by ParkShare on the trusted server, not untrusted Stripe metadata.
-- Review and test on isolated branch before any QA database deployment.

begin;
set local lock_timeout = '5s';

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

-- Keep a limited audit window for genuine checkouts whose Stripe event may
-- be delayed beyond the 30-minute availability hold. Expired holds do not
-- block new reservations (create_booking_hold filters by expires_at > now()).
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

  -- Serialize all availability decisions for this listing. Two simultaneous
  -- requests cannot both observe the same last space as free.
  perform pg_advisory_xact_lock(p_listing_id);

  select greatest(coalesce(spaces, 1), 1)
    into v_capacity
  from public.listings
  where id = p_listing_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Listing not found';
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

  return v_hold_id;
end;
$$;

commit;
