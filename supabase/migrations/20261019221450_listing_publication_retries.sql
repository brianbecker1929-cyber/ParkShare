-- QA-only additive publication ledger. No existing listing/booking/photo changes.
CREATE TABLE parkshare_private.listing_publications (
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  listing_id bigint UNIQUE,
  time_zone text,
  rejection text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (host_id,request_id),
  CHECK ((listing_id IS NOT NULL AND time_zone IS NOT NULL AND rejection IS NULL)
    OR (listing_id IS NULL AND time_zone IS NULL AND rejection IS NOT NULL))
);
-- No listing FK: retain a tombstone after deletion, so a retry cannot resurrect it.
ALTER TABLE parkshare_private.listing_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON parkshare_private.listing_publications FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA parkshare_private TO service_role;
GRANT SELECT,INSERT ON parkshare_private.listing_publications TO service_role;

CREATE FUNCTION public.publish_host_listing(
  p_host_id uuid,p_request_id uuid,p_payload_hash text,
  p_listing jsonb DEFAULT NULL,p_rejection text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  previous parkshare_private.listing_publications%ROWTYPE;
  saved public.listings%ROWTYPE;
  candidate public.listings%ROWTYPE;
BEGIN
  IF p_host_id IS NULL OR p_request_id IS NULL OR p_payload_hash IS NULL
    OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid publication identity';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_host_id AND role='host') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only Hosts can publish listings';
  END IF;
  -- Lock absent keys as well as committed requests. Both writes commit together.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_host_id::text||':'||p_request_id::text,0));
  SELECT * INTO previous FROM parkshare_private.listing_publications
    WHERE host_id=p_host_id AND request_id=p_request_id;
  IF FOUND THEN
    IF previous.payload_hash<>p_payload_hash THEN
      RAISE EXCEPTION USING ERRCODE='P0061',MESSAGE='Publication payload changed';
    END IF;
    IF previous.rejection IS NOT NULL THEN
      RETURN jsonb_build_object('rejected',true,'error',previous.rejection);
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.listings WHERE id=previous.listing_id AND host_id=p_host_id) THEN
      RAISE EXCEPTION USING ERRCODE='P0062',MESSAGE='Published listing was deleted';
    END IF;
    RETURN jsonb_build_object('id',previous.listing_id,'timeZone',previous.time_zone,'replayed',true);
  END IF;
  IF p_rejection IS NOT NULL THEN
    IF p_listing IS NOT NULL OR length(p_rejection)>500 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid publication rejection';
    END IF;
    -- A durable rejection wins against a racing insert before photos may be removed.
    INSERT INTO parkshare_private.listing_publications(host_id,request_id,payload_hash,rejection)
      VALUES(p_host_id,p_request_id,p_payload_hash,p_rejection);
    RETURN jsonb_build_object('rejected',true,'error',p_rejection);
  END IF;
  IF p_listing IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO candidate FROM jsonb_populate_record(NULL::public.listings,p_listing);
  IF candidate.host_id IS DISTINCT FROM p_host_id OR candidate.time_zone IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid server publication';
  END IF;
  INSERT INTO public.listings(host_id,title,address,price,description,features,spaces,photos,img,spots,availability,lat,lng,time_zone)
    VALUES(p_host_id,candidate.title,candidate.address,candidate.price,candidate.description,candidate.features,
      candidate.spaces,candidate.photos,candidate.img,candidate.spots,candidate.availability,candidate.lat,candidate.lng,candidate.time_zone)
    RETURNING * INTO saved;
  INSERT INTO parkshare_private.listing_publications(host_id,request_id,payload_hash,listing_id,time_zone)
    VALUES(p_host_id,p_request_id,p_payload_hash,saved.id,saved.time_zone);
  RETURN jsonb_build_object('id',saved.id,'timeZone',saved.time_zone,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.publish_host_listing(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.publish_host_listing(uuid,uuid,text,jsonb,text) TO service_role;

CREATE FUNCTION public.listing_publication_ready() RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT to_regclass('parkshare_private.listing_publications') IS NOT NULL
    AND to_regprocedure('public.publish_host_listing(uuid,uuid,text,jsonb,text)') IS NOT NULL
    AND NOT has_function_privilege('anon','public.publish_host_listing(uuid,uuid,text,jsonb,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.publish_host_listing(uuid,uuid,text,jsonb,text)','EXECUTE');
$$;
REVOKE ALL ON FUNCTION public.listing_publication_ready() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.listing_publication_ready() TO service_role;
