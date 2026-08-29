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
  status text not null,
  spot_label text,
  session_range tstzrange not null
);
