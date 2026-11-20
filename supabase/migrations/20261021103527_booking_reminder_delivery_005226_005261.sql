-- Durable, service-only reminder delivery snapshots and leases.
-- No booking state or payment data is changed by this migration.
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
