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

begin;
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

commit;
