-- BUG-005138 -- REVIEW-ONLY database proposal. DO NOT RUN on active QA
-- or production without BetterQA approval and a coordinated migration.
-- This is not a numbered migration file.
--
-- listings.availability is currently JSONB written directly by the Host UI.
-- The UI guard alone does not stop direct Data API writes that bypass it.
-- This trigger only reviews INSERT and actual availability edits; it never
-- modifies existing exceptions or blocks unrelated edits to legacy listings.
--
-- Release dependency: BUG-005156 (#159) must confirm the timezone is the
-- DRIVEWAY'S IANA timezone, not the Host browser's timezone. Do not enforce
-- a browser-supplied timezone as authoritative until that change is approved.
--
-- Before deployment, inspect all existing past exception windows privately.
-- Do not backfill, delete, or rewrite any historical availability data.

begin;
set local lock_timeout = '5s';

create or replace function public.reject_past_listing_exceptions_005138()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_zone text;
  v_today date;
  v_exceptions jsonb;
  v_item jsonb;
  v_start text;
  v_end text;
  v_start_date date;
  v_end_date date;
begin
  if TG_OP = 'UPDATE' then
    if NEW.availability is not distinct from OLD.availability then
      return NEW;
    end if;
  end if;

  v_exceptions := NEW.availability -> 'exceptions';
  if v_exceptions is null then return NEW; end if;
  if jsonb_typeof(v_exceptions) <> 'array' then
    raise exception using errcode='23514', message='Invalid availability exceptions list';
  end if;
  if jsonb_array_length(v_exceptions) = 0 then return NEW; end if;

  v_zone := nullif(NEW.availability ->> 'timezone', '');
  if v_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = v_zone
  ) then
    raise exception using errcode='23514', message='Listing schedule timezone is invalid';
  end if;
  v_today := (clock_timestamp() at time zone v_zone)::date;

  for v_item in select value from jsonb_array_elements(v_exceptions) as e(value)
  loop
    v_start := v_item ->> 'startDate';
    v_end := v_item ->> 'endDate';
    if v_start is null or v_start !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or v_end is null or v_end !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception using errcode='23514', message='Availability exception dates must use YYYY-MM-DD';
    end if;
    begin
      v_start_date := v_start::date;
      v_end_date := v_end::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='23514', message='Invalid calendar date in availability exception';
    end;
    if to_char(v_start_date, 'YYYY-MM-DD') <> v_start
       or to_char(v_end_date, 'YYYY-MM-DD') <> v_end
       or v_start_date < v_today
       or v_end_date < v_today
       or v_end_date < v_start_date then
      raise exception using errcode='23514', message='Availability exception must start today or later and end no earlier than its start';
    end if;
  end loop;
  return NEW;
end;
$$;

revoke all on function public.reject_past_listing_exceptions_005138()
  from public, anon, authenticated;

drop trigger if exists listings_no_past_exceptions_005138 on public.listings;
create trigger listings_no_past_exceptions_005138
before insert or update of availability on public.listings
for each row
execute function public.reject_past_listing_exceptions_005138();

commit;

-- Reviewed rollback, if authorized:
-- drop trigger if exists listings_no_past_exceptions_005138 on public.listings;
-- drop function if exists public.reject_past_listing_exceptions_005138();
