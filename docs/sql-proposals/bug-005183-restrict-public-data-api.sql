-- BUG-005183: REVIEW-ONLY RLS + GRANT change. DO NOT APPLY AUTOMATICALLY.
-- Source: read-only ParkShare-QA policy inspection on October 17, 2026.
-- Not an executable numbered migration; use a controlled Supabase migration
-- after BetterQA approves an integrated API/client/SQL release.
--
-- CAUTION: This intentionally closes DIRECT public Data API reads.
-- Apply only when public-parking / public-reviews and authenticated account
-- routes are live, secure and tested in an ISOLATED environment first.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Listings are viewable by everyone" ON public.listings;
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Reviews are viewable by everyone" ON public.reviews;

-- Existing Host INSERT, UPDATE, DELETE policies remain unchanged.
-- Only the owning Host may directly SELECT raw listing address/coordinates.
DROP POLICY IF EXISTS "Hosts read their private listings" ON public.listings;
CREATE POLICY "Hosts read their private listings" ON public.listings
FOR SELECT TO authenticated
USING (host_id = (SELECT auth.uid()));

-- Authenticated users need ONLY their own profile, including login role.
-- All Host and reviewer names for cross-party views are served by the
-- server-authenticated account/booking API, never via public profile joins.
DROP POLICY IF EXISTS "Members read their own profiles" ON public.profiles;
CREATE POLICY "Members read their own profiles" ON public.profiles
FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()));

-- Individual reviewers retain access to their own reviews. Public ratings
-- are exposed only as sanitized summaries via the server endpoint.
DROP POLICY IF EXISTS "Reviewers read their own review rows" ON public.reviews;
CREATE POLICY "Reviewers read their own review rows" ON public.reviews
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

-- Remove inherited/redundant public SELECT grants. Retain authenticated
-- SELECT because Host-owned listings, own profiles, own reviews require it;
-- RLS determines which ROWS are visible to the signed-in user.
REVOKE SELECT ON TABLE public.listings FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.reviews FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.listings TO authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.reviews TO authenticated;

-- Private Storage: PUBLIC bucket metadata currently permits anonymous URL
-- reads bypassing API controls. Existing stored URL strings remain valid as
-- lookup keys, but only the server will be authorized to download the object.
UPDATE storage.buckets SET public = false WHERE id = 'listing-photos';
-- Review any extra storage.objects SELECT policies before applying. Present
-- QA policies allow ONLY the owning Host to SELECT objects.
-- Never grant a blanket anonymous Storage SELECT policy.

-- Never grant service-role privileges to browser/public roles.
-- Service-role stays server-side and bypasses RLS as already configured.
COMMIT;

-- REQUIRED after a separate approved deployment:
-- test anon: SELECT raw listings/profiles/reviews via PostgREST must be 403.
-- test signed-in Driver with no booking: listings SELECT must yield no rows.
-- test Host: own listing edit and profile SELECT still function.
-- test Driver with paid booking: exact address through authenticated API ONLY.
-- test Driver with cancelled/unpaid booking: exact address denied.
-- test review posting, reading own row and safe public review summaries.
-- test no leaks via related views/functions/joins/queries/cache.
