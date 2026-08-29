-- ParkShare migration 006
-- Records who cancelled a booking and tracks Stripe's refund lifecycle
-- separately from the booking's business status.

begin;

alter table public.bookings add column if not exists cancellation_requested_at timestamptz;
alter table public.bookings add column if not exists cancelled_at timestamptz;
alter table public.bookings add column if not exists cancelled_by text;
alter table public.bookings add column if not exists cancellation_reason text;
alter table public.bookings add column if not exists stripe_refund_id text;
alter table public.bookings add column if not exists refund_amount numeric;
alter table public.bookings add column if not exists refund_status text;
alter table public.bookings add column if not exists refund_failure_reason text;

alter table public.bookings drop constraint if exists bookings_cancelled_by_check;
alter table public.bookings add constraint bookings_cancelled_by_check
  check (cancelled_by is null or cancelled_by in ('driver', 'host', 'support', 'system'));

alter table public.bookings drop constraint if exists bookings_refund_status_check;
alter table public.bookings add constraint bookings_refund_status_check
  check (refund_status is null or refund_status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled'));

alter table public.bookings drop constraint if exists bookings_refund_amount_check;
alter table public.bookings add constraint bookings_refund_amount_check
  check (refund_amount is null or refund_amount >= 0);

create unique index if not exists bookings_stripe_refund_id_idx
  on public.bookings (stripe_refund_id)
  where stripe_refund_id is not null;

commit;
