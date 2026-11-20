-- ParkShare security fix 010: a Host must never delete paid reservations
-- by deleting the parent driveway listing.
--
-- Existing schema used ON DELETE CASCADE on bookings.listing_id and
-- booking_holds.listing_id. RESTRICT prevents both historical financial
-- records and in-flight checkout holds from being destroyed by any client,
-- including direct REST calls that bypass the Host Dashboard.
--
-- This intentionally prevents deletion of a listing with ANY booking
-- history, including completed and refunded records. Retiring listings
-- without deleting financial history will be a separate feature.
--
-- Apply to ParkShare-QA ONLY during a coordinated BetterQA retest window.
-- Do not change production without separate approval.

begin;
set local lock_timeout = '5s';

alter table public.bookings
  drop constraint if exists bookings_listing_id_fkey;
alter table public.bookings
  add constraint bookings_listing_id_fkey
  foreign key (listing_id) references public.listings (id)
  on delete restrict;

alter table public.booking_holds
  drop constraint if exists booking_holds_listing_id_fkey;
alter table public.booking_holds
  add constraint booking_holds_listing_id_fkey
  foreign key (listing_id) references public.listings (id)
  on delete restrict;

commit;
