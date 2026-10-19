-- BUG-005187. Additive: no existing listing, booking, or Storage object is deleted.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE SCHEMA IF NOT EXISTS parkshare_private;
REVOKE ALL ON SCHEMA parkshare_private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.listing_photo_cleanup (
  object_path text PRIMARY KEY,
  host_id uuid NOT NULL,
  listing_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT listing_photo_cleanup_owned_path CHECK (
    object_path ~ ('^' || host_id::text || '/[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\.(jpg|png|webp)$')
  )
);
CREATE INDEX listing_photo_cleanup_due ON public.listing_photo_cleanup(next_attempt_at);
ALTER TABLE public.listing_photo_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_photo_cleanup FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.listing_photo_cleanup TO service_role;

-- The definer is necessary only to let a successful RLS-scoped DELETE insert
-- a private job. This trigger-only function has no browser EXECUTE grant.
CREATE FUNCTION parkshare_private.queue_deleted_listing_photos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE photo text; object_key text;
BEGIN
  IF TG_OP <> 'DELETE' OR TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'listings' THEN
    RAISE EXCEPTION 'Unsupported photo cleanup trigger';
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() <> OLD.host_id THEN
    RAISE EXCEPTION 'Listing owner required' USING ERRCODE = '42501';
  END IF;
  FOR photo IN
    SELECT DISTINCT value FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(OLD.photos) = 'array' THEN OLD.photos ELSE '[]'::jsonb END
      || jsonb_build_array(OLD.img)
    ) AS p(value)
  LOOP
    object_key := regexp_replace(split_part(photo, '?', 1),
      '^https://[^/]+/storage/v1/object/(public|sign|authenticated)/listing-photos/', '');
    IF object_key ~ ('^' || OLD.host_id::text || '/[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\.(jpg|png|webp)$') THEN
      INSERT INTO public.listing_photo_cleanup(object_path, host_id, listing_id)
      VALUES(object_key, OLD.host_id, OLD.id)
      ON CONFLICT(object_path) DO UPDATE SET listing_id = EXCLUDED.listing_id, next_attempt_at = now();
    END IF;
  END LOOP;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION parkshare_private.queue_deleted_listing_photos() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER queue_deleted_listing_photos AFTER DELETE ON public.listings
FOR EACH ROW EXECUTE FUNCTION parkshare_private.queue_deleted_listing_photos();

-- Caller must already have service-role table access. Any photo still in use
-- by a remaining listing is withheld, including covers and signed URL variants.
CREATE FUNCTION public.listing_photo_cleanup_batch(target_listing_id bigint DEFAULT NULL, batch_limit integer DEFAULT 50)
RETURNS TABLE(object_path text, host_id uuid)
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT q.object_path, q.host_id FROM public.listing_photo_cleanup AS q
  WHERE q.next_attempt_at <= now()
    AND (target_listing_id IS NULL OR q.listing_id = target_listing_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.listings AS l,
        LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(l.photos) = 'array' THEN l.photos ELSE '[]'::jsonb END
          || jsonb_build_array(l.img)
        ) AS p(value)
      WHERE regexp_replace(split_part(p.value, '?', 1),
        '^https://[^/]+/storage/v1/object/(public|sign|authenticated)/listing-photos/', '') = q.object_path
    )
  ORDER BY q.next_attempt_at, q.object_path
  LIMIT least(greatest(coalesce(batch_limit, 50), 1), 50);
$$;
REVOKE ALL ON FUNCTION public.listing_photo_cleanup_batch(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.listing_photo_cleanup_batch(bigint, integer) TO service_role;
COMMIT;
