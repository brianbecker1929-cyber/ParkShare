-- Persist the exact vehicle selected during checkout. These values are a
-- booking-time snapshot so later profile edits cannot change a reservation.
alter table public.bookings add column if not exists vehicle_profile_id text;
alter table public.bookings add column if not exists vehicle_type text;
alter table public.bookings add column if not exists vehicle_make text;
alter table public.bookings add column if not exists vehicle_model text;
alter table public.bookings add column if not exists vehicle_colour text;
alter table public.bookings add column if not exists license_plate text;

alter table public.bookings drop constraint if exists bookings_vehicle_type_check;
alter table public.bookings add constraint bookings_vehicle_type_check check (
  vehicle_type is null or vehicle_type in ('primary', 'guest')
);

comment on column public.bookings.vehicle_profile_id is 'Primary or saved guest vehicle identifier selected at checkout.';
comment on column public.bookings.license_plate is 'License plate snapshot visible only through existing Driver/Host booking policies.';

