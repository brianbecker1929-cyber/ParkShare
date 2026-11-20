-- DRAFT ONLY. Not executed against BetterQA QA or production.
-- Before rollout: inspect existing duplicate (listing_id,user_id) reviews,
-- resolve legitimate historical reviews, then create a reviewed migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can leave reviews" ON public.reviews;
-- Both the listing detail and My Bookings forms now use /api/reviews,
-- which validates verified JWT, paid booking, and session end server-side.
REVOKE INSERT ON public.reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.reviews TO service_role;
-- Exactly one review per Driver/listing, including concurrent requests.
-- Requires existing duplicates to be resolved BEFORE deploying.
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_driver_listing
  ON public.reviews(listing_id,user_id);
COMMIT;
-- SQL alone is not a safe launch migration without the corresponding
-- application change and a duplicate scan; do not merge independently.
