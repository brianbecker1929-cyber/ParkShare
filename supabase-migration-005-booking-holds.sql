-- ParkShare security migration 005
-- Atomic, expiring holds prevent two renters from entering Stripe Checkout
-- for the same last available parking space.

begin;

create table if not exists public.booking_holds (
  id uuid primary key default gen_random_uuid(),
  listing_id bigint not null references public.listings(id) on delete cascade,
  renter_id uuid not null references auth.users(id) on delete cascade,
  spot_label text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now(),
  constraint booking_holds_window_check check (ends_at > starts_at)
);

create index if not exists booking_holds_listing_window_idx
  on public.booking_holds (listing_id, starts_at, ends_at);
create index if not exists booking_holds_expires_at_idx
  on public.booking_holds (expires_at);

alter table public.booking_holds enable row level security;
revoke all privileges on table public.booking_holds from public, anon, authenticated;

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

  delete from public.booking_holds where expires_at <= now();

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

revoke execute on function public.create_booking_hold(bigint, uuid, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_booking_hold(bigint, uuid, text, timestamptz, timestamptz, timestamptz)
  to service_role;

commit;

select table_name, privilege_type, grantee
from information_schema.table_privileges
where table_schema = 'public'
  and table_name = 'booking_holds'
  and grantee in ('anon', 'authenticated');
