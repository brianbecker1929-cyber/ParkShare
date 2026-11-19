-- Operator-only aggregate checks after a separately approved cutover.
-- No worker invocation, external provider call, customer rows or secret values.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=public,extensions;
SELECT package_id,source_commit,inputs_sha256,applied_at
FROM parkshare_private.production_release_versions;
SELECT 'public_tables_without_rls' check_name,count(*) failures
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
SELECT 'browser_money_or_delivery_access' check_name,count(*) failures
FROM unnest(ARRAY['booking_refund_operations','booking_cancellation_reviews','payment_refunds','booking_reminder_deliveries','refund_email_deliveries','message_email_deliveries','listing_photo_cleanup','pending_booking_extensions','booking_hold_attempts']) t(name)
CROSS JOIN unnest(ARRAY['anon','authenticated']) r(name)
WHERE has_table_privilege(r.name,'public.'||t.name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE');
SELECT listing_timezone_assignment_ready() property_guard_ready,
       listing_publication_ready() publication_ready;
SELECT jsonb_build_object(
 'bookings',(SELECT count(*) FROM public.bookings),
 'paid_bookings',(SELECT count(*) FROM public.bookings WHERE paid_at IS NOT NULL),
 'extensions',(SELECT count(*) FROM public.booking_extensions),
 'listings_missing_trusted_zone',(SELECT count(*) FROM public.listings WHERE time_zone IS NULL),
 'money_jobs_queued',(SELECT count(*) FROM public.booking_refund_operations WHERE state='queued'),
 'money_jobs_review',(SELECT count(*) FROM public.booking_refund_operations WHERE state='review'),
 'reminder_jobs',(SELECT count(*) FROM public.booking_reminder_deliveries),
 'refund_email_jobs',(SELECT count(*) FROM public.refund_email_deliveries),
 'chat_email_jobs',(SELECT count(*) FROM public.message_email_deliveries),
 'photo_deletion_jobs',(SELECT count(*) FROM public.listing_photo_cleanup),
 'photo_bucket_private',(SELECT public=false FROM storage.buckets WHERE id='listing-photos')
) status;
COMMIT;
