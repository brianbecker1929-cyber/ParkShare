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

commit;
