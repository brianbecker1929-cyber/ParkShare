-- Run after the provider engine upgrade, before changing the application/schema.
-- Returns check results; never changes old paid bookings to match new zone rules.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH examples(label,zone,local_time,expected_utc) AS (VALUES
  ('Vancouver winter','America/Vancouver','2026-11-18 10:00'::timestamp,'2026-11-18 17:00+00'::timestamptz),
  ('Vancouver next spring','America/Vancouver','2027-03-14 10:00'::timestamp,'2027-03-14 17:00+00'::timestamptz),
  ('Toronto before spring','America/Toronto','2027-03-13 09:00'::timestamp,'2027-03-13 14:00+00'::timestamptz),
  ('Toronto after spring','America/Toronto','2027-03-15 09:00'::timestamp,'2027-03-15 13:00+00'::timestamptz),
  ('Regina winter','America/Regina','2026-11-18 10:00'::timestamp,'2026-11-18 16:00+00'::timestamptz),
  ('Edmonton winter','America/Edmonton','2026-11-18 10:00'::timestamp,'2026-11-18 16:00+00'::timestamptz),
  ('Winnipeg winter','America/Winnipeg','2026-11-18 10:00'::timestamp,'2026-11-18 15:00+00'::timestamptz),
  ('Inuvik winter','America/Inuvik','2026-11-18 10:00'::timestamp,'2026-11-18 16:00+00'::timestamptz)
)
SELECT label,zone,local_time,expected_utc AT TIME ZONE 'UTC' expected_utc,
  (local_time AT TIME ZONE zone) AT TIME ZONE 'UTC' observed_utc,
  (local_time AT TIME ZONE zone)=expected_utc passed
FROM examples ORDER BY label;
SELECT 'Toronto spring elapsed' check_name,
  (('2027-03-14 04:00'::timestamp AT TIME ZONE 'America/Toronto')-
   ('2027-03-14 01:00'::timestamp AT TIME ZONE 'America/Toronto'))=interval '2 hours' passed;
SELECT 'Toronto autumn elapsed' check_name,
  (('2027-11-07 03:00'::timestamp AT TIME ZONE 'America/Toronto')-
   ('2027-11-07 00:00'::timestamp AT TIME ZONE 'America/Toronto'))=interval '4 hours' passed;
COMMIT;
