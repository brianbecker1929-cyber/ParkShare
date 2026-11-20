-- Planning / pre-window / post-engine counts only. No raw rows or row digests.
-- Capture again AFTER writes are quiesced; this does not stop concurrent writes.
-- Equal counts and sequence positions do not prove every stored value unchanged.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH table_summaries AS (
SELECT 'booking_extensions' table_name,count(*) row_count FROM public."booking_extensions"
UNION ALL
SELECT 'booking_holds' table_name,count(*) row_count FROM public."booking_holds"
UNION ALL
SELECT 'bookings' table_name,count(*) row_count FROM public."bookings"
UNION ALL
SELECT 'event_listing_access' table_name,count(*) row_count FROM public."event_listing_access"
UNION ALL
SELECT 'event_submissions' table_name,count(*) row_count FROM public."event_submissions"
UNION ALL
SELECT 'events' table_name,count(*) row_count FROM public."events"
UNION ALL
SELECT 'listings' table_name,count(*) row_count FROM public."listings"
UNION ALL
SELECT 'messages' table_name,count(*) row_count FROM public."messages"
UNION ALL
SELECT 'profiles' table_name,count(*) row_count FROM public."profiles"
UNION ALL
SELECT 'reviews' table_name,count(*) row_count FROM public."reviews"
), sequence_summaries AS (
SELECT 'booking_extensions_id_seq' sequence_name,last_value,is_called FROM public."booking_extensions_id_seq"
UNION ALL
SELECT 'bookings_id_seq' sequence_name,last_value,is_called FROM public."bookings_id_seq"
UNION ALL
SELECT 'event_submissions_id_seq' sequence_name,last_value,is_called FROM public."event_submissions_id_seq"
UNION ALL
SELECT 'events_id_seq' sequence_name,last_value,is_called FROM public."events_id_seq"
UNION ALL
SELECT 'listings_id_seq' sequence_name,last_value,is_called FROM public."listings_id_seq"
UNION ALL
SELECT 'messages_id_seq' sequence_name,last_value,is_called FROM public."messages_id_seq"
UNION ALL
SELECT 'reviews_id_seq' sequence_name,last_value,is_called FROM public."reviews_id_seq"
)
SELECT jsonb_build_object(
 'checked_at',now(),'database',current_database(),'comparison_scope','Schema, counts and sequence positions; no row-value equality claim',
 'public_tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name) FROM table_summaries t),
 'public_sequences',(SELECT jsonb_agg(to_jsonb(s) ORDER BY sequence_name) FROM sequence_summaries s),
 'auth_users',(SELECT count(*) FROM auth.users),
 'auth_identities',(SELECT count(*) FROM auth.identities),
 'storage_buckets',(SELECT count(*) FROM storage.buckets),
 'storage_objects',(SELECT count(*) FROM storage.objects)
) snapshot;
COMMIT;
