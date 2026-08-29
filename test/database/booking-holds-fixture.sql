-- Minimal Supabase-compatible schema for exercising migration 005 against a
-- disposable PostgreSQL database. Production tables contain more columns;
-- only the dependencies read by create_booking_hold() are represented here.

drop schema if exists public cascade;
drop schema if exists auth cascade;

create schema public;
create schema auth;

do $$
begin
  create role anon nologin;
exception when duplicate_object then null;
end
$$;

do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end
$$;

do $$
begin
  create role service_role nologin;
exception when duplicate_object then null;
end
$$;

create table auth.users (
  id uuid primary key
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade
);

create table public.listings (
  id bigint generated always as identity primary key,
  host_id uuid not null references public.profiles(id) on delete cascade,
  spaces integer not null default 1
);

create table public.bookings (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings(id) on delete cascade,
  renter_id uuid references public.profiles(id) on delete cascade,
  hours numeric not null default 1,
  total numeric not null default 0,
  subtotal numeric,
  service_fee numeric,
  status text not null check (
    status in ('pending', 'confirmed', 'cancelled', 'completed', 'payment_failed', 'refunded', 'partially_refunded', 'disputed')
  ),
  spot_label text,
  session_range tstzrange not null,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_connected_account_id text,
  cancellation_requested_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('driver', 'host', 'support', 'system')),
  cancellation_reason text,
  stripe_refund_id text unique,
  refund_amount numeric check (refund_amount is null or refund_amount >= 0),
  refund_status text check (refund_status is null or refund_status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  refund_failure_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index bookings_stripe_payment_intent_id_idx
  on public.bookings (stripe_payment_intent_id);

create index bookings_stripe_charge_id_idx
  on public.bookings (stripe_charge_id);
