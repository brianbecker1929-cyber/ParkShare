-- BUG-005138 follow-up: inclusive 12-calendar-month exception horizon.
-- QA rollout: replaces the existing invoker trigger function only.
-- No listing/booking data, policies, grants or trigger wiring are rewritten.
begin;
set local lock_timeout = '5s';
do $$
begin
  if to_regprocedure('public.reject_past_listing_exceptions_005138()') is null
     or not exists (select 1 from pg_trigger where tgrelid='public.listings'::regclass and tgname='listings_no_past_exceptions_005138' and not tgisinternal) then
    raise exception 'Existing BUG-005138 exception guard is required';
  end if;
end;
$$;

create or replace function public.reject_past_listing_exceptions_005138()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_zone text;
  v_today date;
  v_latest date;
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
  if v_exceptions is null or jsonb_typeof(v_exceptions) = 'null' then return NEW; end if;
  if jsonb_typeof(v_exceptions) <> 'array' then
    raise exception using errcode='23514', message='Invalid availability exceptions list';
  end if;
  if jsonb_array_length(v_exceptions) = 0 then return NEW; end if;

  v_zone := nullif(NEW.time_zone, '');
  if v_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = v_zone
  ) then
    raise exception using errcode='23514', message='A trusted property timezone is required for availability exceptions';
  end if;
  if nullif(NEW.availability ->> 'timezone', '') is distinct from v_zone then
    raise exception using errcode='23514', message='Availability timezone must match the trusted property timezone';
  end if;
  v_today := (clock_timestamp() at time zone v_zone)::date;
  v_latest := (v_today + interval '12 months')::date;

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
    if v_start_date > v_latest or v_end_date > v_latest then
      raise exception using errcode='23514', message='Special dates must be within 12 calendar months of today';
    end if;
  end loop;
  return NEW;
end;
$$;

revoke all on function public.reject_past_listing_exceptions_005138()
  from public, anon, authenticated;

commit;
