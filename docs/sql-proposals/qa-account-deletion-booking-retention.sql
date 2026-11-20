-- REVIEW-ONLY database proposal. DO NOT EXECUTE on ParkShare-QA or production.
-- Account-deletion financial history gap discovered October 18, 2026.
--
-- Confirmed read-only on BOTH environments:
--   bookings.renter_id -> profiles(id) ON DELETE CASCADE
--   listings.host_id  -> profiles(id) ON DELETE CASCADE
--   profiles.id       -> auth.users(id) ON DELETE CASCADE
-- Thus deleting a Driver profile can silently erase their paid/refunded
-- bookings, and deleting a Host profile can erase listings and, on
-- production, associated bookings and extension financial records.
--
-- Fail closed at BOTH profile-facing FKs. A proper account-removal process
-- must instead preserve required transaction records and assess lawful
-- retention/anonymization, Stripe/audit obligations and privacy rights.
-- Explicit product/legal approval REQUIRED before deployment.
--
-- Does NOT repair production bookings.listing_id ON DELETE CASCADE;
-- review existing migration 010 before rollout. Does NOT protect manual
-- direct DELETE FROM bookings; that is a separate authorization/audit task.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Deliberately no IF EXISTS: schema mismatch should fail atomically.
ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_renter_id_fkey;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_renter_id_fkey
  FOREIGN KEY (renter_id) REFERENCES public.profiles(id)
  ON DELETE RESTRICT;

ALTER TABLE public.listings
  DROP CONSTRAINT listings_host_id_fkey;
ALTER TABLE public.listings
  ADD CONSTRAINT listings_host_id_fkey
  FOREIGN KEY (host_id) REFERENCES public.profiles(id)
  ON DELETE RESTRICT;

COMMIT;
