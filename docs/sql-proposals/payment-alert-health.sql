-- Review-only; depends on payment-emergency-alert-outbox.sql. Disposable CI only
-- until a separately approved application/schema/monitor rollout.
begin;
set local lock_timeout='5s';
create table public.payment_alert_worker_health (
  livemode boolean primary key,
  completed_at timestamptz not null,
  failed_count integer not null check(failed_count between 0 and 5)
);
alter table public.payment_alert_worker_health enable row level security;
revoke all on public.payment_alert_worker_health from public,anon,authenticated;
grant select,insert,update on public.payment_alert_worker_health to service_role;
create policy payment_alert_health_service on public.payment_alert_worker_health
  for all to service_role using(true) with check(true);
create index payment_alert_health_pending_idx
  on public.payment_alert_deliveries(livemode,created_at) include(blocked_at)
  where accepted_at is null;

create function public.record_payment_alert_worker_health(p_livemode boolean,p_failed_count integer)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_livemode is null or p_failed_count is null or p_failed_count not between 0 and 5 then
    raise exception using errcode='22023',message='Invalid worker health result';
  end if;
  insert into public.payment_alert_worker_health(livemode,completed_at,failed_count)
    values(p_livemode,clock_timestamp(),p_failed_count)
    on conflict(livemode) do update set
      completed_at=greatest(public.payment_alert_worker_health.completed_at,clock_timestamp()),
      failed_count=excluded.failed_count;
  return true;
end $$;

create function public.get_payment_alert_health(p_livemode boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz=clock_timestamp(); result jsonb;
begin
  if p_livemode is null then raise exception using errcode='22023',message='Mode required'; end if;
  select jsonb_build_object(
    'observed_at',stamp,
    'worker_completed_at',(select h.completed_at from public.payment_alert_worker_health h where h.livemode=p_livemode),
    'worker_failed_count',coalesce((select h.failed_count from public.payment_alert_worker_health h where h.livemode=p_livemode),0),
    'pending_count',count(*) filter(where a.blocked_at is null),
    'blocked_count',count(*) filter(where a.blocked_at is not null),
    'stale_pending_count',count(*) filter(where a.blocked_at is null and a.created_at<=stamp-interval '15 minutes')
  ) into result from public.payment_alert_deliveries a
    where a.livemode=p_livemode and a.accepted_at is null;
  return result;
end $$;
revoke all on function public.record_payment_alert_worker_health(boolean,integer) from public,anon,authenticated;
revoke all on function public.get_payment_alert_health(boolean) from public,anon,authenticated;
grant execute on function public.record_payment_alert_worker_health(boolean,integer) to service_role;
grant execute on function public.get_payment_alert_health(boolean) to service_role;
comment on table public.payment_alert_worker_health is 'Service-only completed email-drain heartbeat. No customer data, financial actions or automatic recovery.';
commit;
