-- Release prerequisite evidence only. Does not change schema, rows or settings.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT now() checked_at, current_setting('server_version') server_version,
  ('2026-11-18 10:00'::timestamp AT TIME ZONE 'America/Vancouver') =
    '2026-11-18 17:00:00+00'::timestamptz AS vancouver_rules_current,
  ('2027-03-14 04:00'::timestamp AT TIME ZONE 'America/Toronto') -
    ('2027-03-14 01:00'::timestamp AT TIME ZONE 'America/Toronto') =
      interval '2 hours' AS toronto_spring_elapsed_correct,
  (SELECT count(*) FROM public.booking_holds WHERE expires_at > now()) active_checkout_holds,
  (SELECT count(*) FROM public.booking_holds WHERE stripe_checkout_session_id IS NOT NULL) retained_checkout_references;
COMMIT;
