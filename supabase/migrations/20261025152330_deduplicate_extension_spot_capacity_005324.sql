BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

-- Change only the reviewed capacity expressions. Keep existing locks, quotas,
-- payment/identity checks, owner, SECURITY attributes and EXECUTE grants.
-- Refuse an unexpected function version rather than replacing newer work.
DO $migration$
DECLARE
 definition text;
 old_expression text := $old$  select
    (select count(*) from public.bookings b
      where b.listing_id = p_listing_id
        and b.status = 'confirmed'
        and b.session_range && tstzrange(p_starts_at, p_ends_at, '[)'))
    +
    (select count(*) from public.booking_holds h
      where h.listing_id = p_listing_id
        and h.expires_at > now()
        and h.starts_at < p_ends_at
        and p_starts_at < h.ends_at)
    into v_taken;$old$;
 new_expression text := $new$  select count(*) into v_taken from (
    select coalesce('spot:' || nullif(upper(trim(b.spot_label)), ''), 'booking:' || b.id::text) as inventory_key
    from public.bookings b
    where b.listing_id = p_listing_id and b.status = 'confirmed'
      and b.session_range && tstzrange(p_starts_at, p_ends_at, '[)')
    union
    select coalesce('spot:' || nullif(upper(trim(h.spot_label)), ''), 'hold:' || h.id::text)
    from public.booking_holds h
    where h.listing_id = p_listing_id and h.expires_at > now()
      and h.starts_at < p_ends_at and p_starts_at < h.ends_at
  ) occupied_spots;$new$;
BEGIN
 SELECT pg_get_functiondef('public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)'::regprocedure) INTO definition;
 IF strpos(definition, old_expression) = 0 THEN
  RAISE EXCEPTION 'Unexpected create_booking_hold definition; review before migration';
 END IF;
 EXECUTE replace(definition, old_expression, new_expression);

 old_expression := $old$ SELECT count(*) INTO v_other_bookings FROM public.bookings x
 WHERE x.listing_id=v_listing_id AND x.id<>p_booking_id
 AND x.status='confirmed' AND x.session_range && v_range;
 SELECT count(*) INTO v_other_holds FROM public.booking_holds h
 WHERE h.listing_id=v_listing_id AND h.expires_at>now()
 AND h.id<>p.hold_id
 AND h.starts_at<v_new_end AND h.ends_at>v_old_end;$old$;
 new_expression := $new$ SELECT count(*) INTO v_other_bookings FROM (
  SELECT coalesce('spot:' || nullif(upper(trim(x.spot_label)), ''), 'booking:' || x.id::text) AS inventory_key
  FROM public.bookings x WHERE x.listing_id=v_listing_id AND x.id<>p_booking_id
   AND x.status='confirmed' AND x.session_range && v_range
  UNION
  SELECT coalesce('spot:' || nullif(upper(trim(h.spot_label)), ''), 'hold:' || h.id::text)
  FROM public.booking_holds h WHERE h.listing_id=v_listing_id AND h.expires_at>now()
   AND h.id<>p.hold_id AND h.starts_at<v_new_end AND h.ends_at>v_old_end
 ) occupied_spots;
 v_other_holds := 0;$new$;
 SELECT pg_get_functiondef('public.apply_paid_booking_extension(text,bigint,uuid,numeric,integer,text,text,text,timestamptz)'::regprocedure) INTO definition;
 IF strpos(definition, old_expression) = 0 THEN
  RAISE EXCEPTION 'Unexpected apply_paid_booking_extension definition; review before migration';
 END IF;
 EXECUTE replace(definition, old_expression, new_expression);
END;
$migration$;
NOTIFY pgrst, 'reload schema';
COMMIT;
