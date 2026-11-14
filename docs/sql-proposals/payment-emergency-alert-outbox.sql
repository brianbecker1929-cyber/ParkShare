-- Review-only proposal. Apply only in a disposable rehearsal until a separate
-- rollout is approved. Creates an empty outbox; no historical jobs or sends.
begin;
set local lock_timeout='5s';
create table public.payment_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check(length(idempotency_key)<=256
    and idempotency_key ~ '^parkshare-payment-alert-v2/(production|qa)/[a-z_]+/[0-9a-f]{64}$'),
  kind text not null check(kind in ('webhook_processing_failed','paid_checkout_needs_review',
    'paid_checkout_rejected','refund_needs_review','refund_retry_required','refund_failed')),
  livemode boolean not null,
  payload jsonb not null check(coalesce(jsonb_typeof(payload)='object'
    and jsonb_typeof(payload->'to')='array' and jsonb_array_length(payload->'to')=1
    and jsonb_typeof(payload->'from')='string' and jsonb_typeof(payload->'subject')='string'
    and jsonb_typeof(payload->'text')='string',false)),
  created_at timestamptz not null default clock_timestamp(),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default '-infinity',
  lease_until timestamptz not null default '-infinity',
  lease_token uuid,
  attempts integer not null default 0 check(attempts>=0),
  provider_id uuid,
  accepted_at timestamptz,
  blocked_at timestamptz,
  last_error_code text check(last_error_code in ('provider_unavailable','provider_rejected',
    'idempotency_window_expired','configuration_changed','attempts_exhausted')),
  check((accepted_at is null)=(provider_id is null)),
  check(accepted_at is null or blocked_at is null),
  check(livemode=(idempotency_key like 'parkshare-payment-alert-v2/production/%'))
);
create index payment_alert_pending_idx on public.payment_alert_deliveries(next_attempt_at,created_at)
  where accepted_at is null and blocked_at is null;
alter table public.payment_alert_deliveries enable row level security;
revoke all on public.payment_alert_deliveries from public,anon,authenticated;
grant usage on schema public to service_role;
grant select,insert,update on public.payment_alert_deliveries to service_role;
create policy payment_alert_worker on public.payment_alert_deliveries
  for all to service_role using(true) with check(true);

create function public.enqueue_payment_alert(p_key text,p_kind text,p_livemode boolean,p_payload jsonb)
returns public.payment_alert_deliveries language plpgsql security invoker set search_path='' as $$
declare job public.payment_alert_deliveries;
begin
  insert into public.payment_alert_deliveries(idempotency_key,kind,livemode,payload)
    values(p_key,p_kind,p_livemode,p_payload) on conflict(idempotency_key) do nothing;
  select * into strict job from public.payment_alert_deliveries where idempotency_key=p_key;
  if job.payload<>p_payload or job.livemode<>p_livemode or job.kind<>p_kind then
    raise exception using errcode='22023',message='Alert reference already has a different immutable payload';
  end if;
  return job;
end $$;

create function public.claim_payment_alert(p_id uuid,p_token uuid,p_livemode boolean)
returns public.payment_alert_deliveries language plpgsql security invoker set search_path='' as $$
declare job public.payment_alert_deliveries; stamp timestamptz=clock_timestamp();
begin
  if p_token is null then raise exception using errcode='22023',message='Lease token required'; end if;
  select * into job from public.payment_alert_deliveries where id=p_id and livemode=p_livemode
    and accepted_at is null and blocked_at is null and lease_until<=stamp and next_attempt_at<=stamp
    for update skip locked;
  if not found then return null; end if;
  if job.first_attempt_at is not null and job.first_attempt_at<=stamp-interval '23 hours' then
    update public.payment_alert_deliveries set blocked_at=stamp,last_error_code='idempotency_window_expired'
      where id=p_id returning * into job;
    return job;
  end if;
  if job.attempts>=8 then
    update public.payment_alert_deliveries set blocked_at=stamp,last_error_code='attempts_exhausted'
      where id=p_id returning * into job;
    return job;
  end if;
  update public.payment_alert_deliveries set lease_token=p_token,lease_until=stamp+interval '2 minutes',
    first_attempt_at=coalesce(first_attempt_at,stamp),attempts=attempts+1 where id=p_id returning * into job;
  return job;
end $$;

create function public.finish_payment_alert(p_id uuid,p_token uuid,p_outcome text,p_provider_id uuid default null,
  p_code text default null,p_delay_seconds integer default 30) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed integer; stamp timestamptz=clock_timestamp();
begin
  if p_outcome not in ('accepted','retry','blocked') or p_outcome is null
    or (p_outcome='accepted' and p_provider_id is null) then
    raise exception using errcode='22023',message='Invalid alert completion';
  end if;
  update public.payment_alert_deliveries set
    accepted_at=case when p_outcome='accepted' then stamp else null end,
    provider_id=case when p_outcome='accepted' then p_provider_id else null end,
    blocked_at=case when p_outcome='blocked' then stamp else null end,
    next_attempt_at=case when p_outcome='retry' then stamp+make_interval(secs=>greatest(30,least(3600,coalesce(p_delay_seconds,30)))) else next_attempt_at end,
    last_error_code=p_code,lease_token=null,lease_until='-infinity'
    where id=p_id and lease_token=p_token and lease_until>stamp and accepted_at is null and blocked_at is null;
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.enqueue_payment_alert(text,text,boolean,jsonb) from public,anon,authenticated;
revoke all on function public.claim_payment_alert(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.finish_payment_alert(uuid,uuid,text,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.enqueue_payment_alert(text,text,boolean,jsonb) to service_role;
grant execute on function public.claim_payment_alert(uuid,uuid,boolean) to service_role;
grant execute on function public.finish_payment_alert(uuid,uuid,text,uuid,text,integer) to service_role;
comment on table public.payment_alert_deliveries is 'Service-only operational alert outbox. Immutable payload/key, bounded retries and leased acceptance evidence. No financial operations.';
commit;
