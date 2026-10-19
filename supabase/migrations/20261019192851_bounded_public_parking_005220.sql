-- Service-only bounded discovery. Never select images, addresses, identities,
-- free text, or spot geometry. The primary key supplies stable keyset pages;
-- reviews_one_per_driver_listing supplies the rating lookup's leading index.
CREATE OR REPLACE FUNCTION public.public_parking_page(p_before_id bigint DEFAULT NULL)
RETURNS TABLE(id bigint,price numeric,spaces integer,lat double precision,lng double precision,
  spots jsonb,time_zone text,rating numeric,review_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH page AS MATERIALIZED (
    SELECT l.id,l.price,l.spaces,l.lat,l.lng,l.spots,l.time_zone
    FROM public.listings l
    WHERE p_before_id IS NULL OR l.id < p_before_id
    ORDER BY l.id DESC LIMIT 51
  )
  SELECT p.id,p.price,p.spaces,
    round(p.lat::numeric,2)::double precision,round(p.lng::numeric,2)::double precision,
    coalesce((SELECT jsonb_agg(jsonb_build_object('forRent',s.value->'forRent' = 'true'::jsonb) ORDER BY s.ordinality)
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.spots)='array' THEN p.spots ELSE '[]'::jsonb END)
        WITH ORDINALITY s(value,ordinality) WHERE s.ordinality <= 8),'[]'::jsonb),
    p.time_zone,r.rating,r.review_count
  FROM page p
  CROSS JOIN LATERAL (SELECT coalesce(avg(v.rating),0) rating,count(*) review_count
    FROM public.reviews v WHERE v.listing_id=p.id AND v.rating BETWEEN 1 AND 5) r
  ORDER BY p.id DESC;
$$;
REVOKE ALL ON FUNCTION public.public_parking_page(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.public_parking_page(bigint) TO service_role;
