-- QA-ONLY trusted listing metadata. No booking/payment time is rewritten.
-- The private recovery schema must contain independently checked, unambiguous
-- geographic cells from geo-tz@8.1.10. No listing coordinates are exported.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(20261019,187);
LOCK TABLE public.listings IN SHARE ROW EXCLUSIVE MODE;
DO $validate$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM qa_release_backup_20261019.verified_zone_cells) THEN RAISE EXCEPTION 'Load verified QA geography cells before timezone assignment'; END IF;
 IF EXISTS(SELECT 1 FROM qa_release_backup_20261019.verified_zone_cells c WHERE c.verified_source<>'geo-tz@8.1.10' OR NOT EXISTS(SELECT 1 FROM pg_timezone_names z WHERE z.name=c.time_zone)) THEN RAISE EXCEPTION 'Unverified geography cell'; END IF;
END;
$validate$;
CREATE TABLE qa_release_backup_20261019.timezone_assignments_before AS SELECT id,time_zone FROM public.listings;
REVOKE ALL ON TABLE qa_release_backup_20261019.timezone_assignments_before FROM PUBLIC, anon, authenticated;
UPDATE public.listings l SET time_zone=c.time_zone
FROM qa_release_backup_20261019.verified_zone_cells c
WHERE l.time_zone IS NULL AND l.lat BETWEEN -90 AND 90 AND l.lng BETWEEN -180 AND 180
 AND floor(l.lat::numeric*10)=c.south*10 AND floor(l.lng::numeric*10)=c.west*10;
-- No coordinates means no guessed zone. Legacy availability JSON, bookings,
-- paid session ranges, charges and refunds remain unchanged.
DO $preserve$
DECLARE changed bigint;
BEGIN
 SELECT count(*) INTO changed FROM public.bookings b FULL JOIN qa_release_backup_20261019.bookings old ON old.id=b.id
 WHERE b.id IS NULL OR old.id IS NULL OR (to_jsonb(b)-'scheduled_starts_at'-'property_time_zone') IS DISTINCT FROM to_jsonb(old);
 IF changed<>0 THEN RAISE EXCEPTION 'Historical bookings changed during metadata assignment'; END IF;
END;
$preserve$;
NOTIFY pgrst, 'reload schema';
COMMIT;
