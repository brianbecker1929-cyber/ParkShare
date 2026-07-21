-- ParkShare Stripe Connect migration
alter table profiles add column if not exists stripe_account_id text unique;
alter table profiles add column if not exists stripe_onboarding_complete boolean not null default false;
alter table profiles add column if not exists stripe_charges_enabled boolean not null default false;
alter table profiles add column if not exists stripe_payouts_enabled boolean not null default false;
alter table profiles add column if not exists stripe_requirements_due text[] not null default '{}';

alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check check (
  status in ('pending', 'confirmed', 'cancelled', 'completed', 'payment_failed', 'refunded', 'partially_refunded', 'disputed')
);
alter table bookings add column if not exists subtotal numeric;
alter table bookings add column if not exists service_fee numeric;
alter table bookings add column if not exists stripe_checkout_session_id text unique;
alter table bookings add column if not exists stripe_payment_intent_id text;
alter table bookings add column if not exists stripe_charge_id text;
alter table bookings add column if not exists stripe_connected_account_id text;
alter table bookings add column if not exists spot_label text;
alter table bookings add column if not exists booking_date text;
alter table bookings add column if not exists start_hour numeric;
alter table bookings add column if not exists end_hour numeric;
alter table bookings add column if not exists paid_at timestamptz;

create index if not exists profiles_stripe_account_id_idx on profiles(stripe_account_id);
create index if not exists bookings_stripe_payment_intent_id_idx on bookings(stripe_payment_intent_id);
