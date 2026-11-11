-- Recovery QA only. Widen the body-class allowlist before deploying the code.
-- Retain historical primary/guest values and in-flight legacy hold snapshots.
-- Do not invent body classes or acceptance times for historical bookings.
begin;
alter table public.bookings drop constraint if exists bookings_vehicle_type_check;
alter table public.bookings add constraint bookings_vehicle_type_check check (
  vehicle_type is null or vehicle_type in ('primary','guest','sedan','suv','coupe','hatchback','pickup','van')
);
comment on column public.bookings.vehicle_type is 'Saved vehicle body class for new checkouts; NULL when unspecified. Historical primary/guest values predate BUG-005157.';
comment on column public.bookings.confirmation_email_sent_at is 'Provider acceptance time of the Driver booking confirmation; not inbox delivery or Host notification status.';
commit;
