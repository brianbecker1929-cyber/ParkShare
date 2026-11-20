-- BUG-005462: spot leases and checkout-start quotas have different lifetimes.
-- Preserve the 2 active / 4 per 2h / 12 per day limits and audit evidence.
-- Report the earliest instant ALL currently blocking limits permit a start.
-- Modify only the existing quota refusal block; preserve capacity/settlement,
-- advisory-lock order, function ownership, permissions and configuration.
DO $migration$
DECLARE
  target regprocedure := to_regprocedure('public.create_booking_hold(bigint,uuid,text,timestamptz,timestamptz,timestamptz)');
  definition text;
  previous record;
  updated record;
  old_clause constant text := $old$  if (
    select count(*) from public.booking_holds h
    where h.renter_id = p_renter_id and h.expires_at > now()
  ) >= 2 then
    raise exception using errcode = 'P0058',
      message = 'Too many active parking checkouts';
  end if;
  if (
    select count(*) from public.booking_hold_attempts a
    where a.renter_id = p_renter_id
      and a.created_at > now() - interval '2 hours'
  ) >= 4 then
    raise exception using errcode = 'P0058',
      message = 'Parking checkout started too often';
  end if;
  if (
    select count(*) from public.booking_hold_attempts a
    where a.renter_id = p_renter_id
      and a.created_at > now() - interval '24 hours'
  ) >= 12 then
    raise exception using errcode = 'P0058',
      message = 'Daily parking checkout limit reached';
  end if;$old$;
  new_clause constant text := $new$  declare
    v_retry_at timestamptz;
    v_bound timestamptz;
    v_reason text;
    v_limits text[] := '{}';
  begin
    -- With N active holds, N-1 must expire before another can be issued.
    select h.expires_at into v_bound from public.booking_holds h
      where h.renter_id = p_renter_id and h.expires_at > now()
      order by h.expires_at desc offset 1 limit 1;
    if v_bound is not null then
      v_retry_at := v_bound;
      v_reason := 'active_checkouts';
      v_limits := array_append(v_limits, v_reason);
    end if;
    -- The fourth newest start aging out leaves at most three in the window.
    select a.created_at + interval '2 hours' into v_bound
      from public.booking_hold_attempts a
      where a.renter_id = p_renter_id and a.created_at > now() - interval '2 hours'
      order by a.created_at desc offset 3 limit 1;
    if v_bound is not null then
      v_limits := array_append(v_limits, 'two_hour_limit');
      if v_retry_at is null or v_bound > v_retry_at then
        v_retry_at := v_bound; v_reason := 'two_hour_limit';
      end if;
    end if;
    select a.created_at + interval '24 hours' into v_bound
      from public.booking_hold_attempts a
      where a.renter_id = p_renter_id and a.created_at > now() - interval '24 hours'
      order by a.created_at desc offset 11 limit 1;
    if v_bound is not null then
      v_limits := array_append(v_limits, 'daily_limit');
      if v_retry_at is null or v_bound > v_retry_at then
        v_retry_at := v_bound; v_reason := 'daily_limit';
      end if;
    end if;
    if v_retry_at is not null then
      raise exception using errcode = 'P0058', message = 'Parking checkout limit reached',
        detail = jsonb_build_object('version', 1, 'reason', v_reason,
          'limits', v_limits, 'retry_at', v_retry_at)::text;
    end if;
  end;$new$;
BEGIN
  IF target IS NULL THEN RAISE EXCEPTION 'Booking hold function is missing'; END IF;
  SELECT proacl, prosecdef, proconfig, proowner INTO previous FROM pg_proc WHERE oid=target;
  definition := pg_get_functiondef(target);
  IF strpos(definition,new_clause)>0 AND strpos(definition,old_clause)=0 THEN RETURN; END IF;
  IF (length(definition)-length(replace(definition,old_clause,'')))/length(old_clause) <> 1 THEN
    RAISE EXCEPTION 'Booking hold quota definition changed; review before applying';
  END IF;
  EXECUTE replace(definition,old_clause,new_clause);
  SELECT proacl, prosecdef, proconfig, proowner INTO updated FROM pg_proc WHERE oid=target;
  IF previous IS DISTINCT FROM updated THEN
    RAISE EXCEPTION 'Booking hold permissions/configuration changed';
  END IF;
END
$migration$;
