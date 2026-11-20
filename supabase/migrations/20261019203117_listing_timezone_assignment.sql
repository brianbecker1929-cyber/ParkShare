-- Publishing is now a Host-authorized server operation. Preserve existing
-- listings/bookings; protect the location used by the trusted zone resolver.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.listings_enforce_trusted_time_zone()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('service_role','postgres','supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Publish through the ParkShare Host listing service to verify the property time zone';
    END IF;
    IF NEW.time_zone IS DISTINCT FROM OLD.time_zone
      OR NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng
      OR NEW.address IS DISTINCT FROM OLD.address THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Property location and time zone changes require server verification';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.listing_timezone_assignment_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT position('Publish through the ParkShare Host listing service' IN pg_catalog.pg_get_functiondef('public.listings_enforce_trusted_time_zone()'::regprocedure)) > 0
    AND position('Property location and time zone changes require server verification' IN pg_catalog.pg_get_functiondef('public.listings_enforce_trusted_time_zone()'::regprocedure)) > 0;
$$;
REVOKE ALL ON FUNCTION public.listing_timezone_assignment_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.listing_timezone_assignment_ready() TO service_role;
COMMIT;
