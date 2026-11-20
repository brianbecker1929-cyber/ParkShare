-- Queue notifications in the SAME transaction as a verified refund ledger
-- transition. No Stripe request, email or historical replay in this migration.
begin;
set local lock_timeout='5s';
create table parkshare_private.refund_notification_rollout (
  singleton boolean primary key default true check(singleton),
  enabled_at timestamptz not null default date_trunc('second',clock_timestamp())
);
insert into parkshare_private.refund_notification_rollout(singleton) values(true);
alter table parkshare_private.refund_notification_rollout enable row level security;
revoke all on parkshare_private.refund_notification_rollout from public,anon,authenticated;
grant usage on schema parkshare_private to service_role;
grant select on parkshare_private.refund_notification_rollout to service_role;
create policy refund_rollout_worker on parkshare_private.refund_notification_rollout
  for select to service_role using(true);

create table public.refund_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  connected_account_id text not null,
  livemode boolean not null,
  refund_id text not null,
  booking_id bigint not null references public.bookings(id) on delete restrict,
  audience text not null check(audience in ('driver','host')),
  created_at timestamptz not null default now(),
  payload jsonb check(payload is null or jsonb_typeof(payload)='object'),
  first_attempt_at timestamptz,
  lease_until timestamptz not null default '-infinity',
  provider_id text,
  sent_at timestamptz,
  blocked_at timestamptz,
  unique(connected_account_id,livemode,refund_id,audience),
  foreign key(connected_account_id,livemode,refund_id)
    references public.payment_refunds(connected_account_id,livemode,refund_id) on delete restrict,
  check((sent_at is null)=(provider_id is null)),
  check((payload is null)=(first_attempt_at is null))
);
create index refund_email_booking_idx on public.refund_email_deliveries(booking_id);
create index refund_email_pending_idx on public.refund_email_deliveries(lease_until,created_at)
  where sent_at is null and blocked_at is null;
alter table public.refund_email_deliveries enable row level security;
revoke all on public.refund_email_deliveries from public,anon,authenticated;
grant select,insert,update on public.refund_email_deliveries to service_role;
create policy refund_email_worker on public.refund_email_deliveries
  for all to service_role using(true) with check(true);

create function parkshare_private.queue_refund_emails() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent_id bigint; enabled_at timestamptz;
begin
  if new.status<>'succeeded' then return new; end if;
  if tg_op='UPDATE' and old.status='succeeded' then return new; end if;
  select r.enabled_at into strict enabled_at
    from parkshare_private.refund_notification_rollout r where r.singleton;
  -- Newly discovered historical Stripe refunds do not generate surprise mail.
  -- A known pending refund that succeeds after rollout DOES notify both sides.
  if tg_op='INSERT' and new.stripe_created_at < enabled_at then return new; end if;
  parent_id=new.booking_id;
  if parent_id is null then
    select e.booking_id into strict parent_id from public.booking_extensions e where e.id=new.extension_id;
  end if;
  insert into public.refund_email_deliveries(connected_account_id,livemode,refund_id,booking_id,audience)
    values(new.connected_account_id,new.livemode,new.refund_id,parent_id,'driver'),
          (new.connected_account_id,new.livemode,new.refund_id,parent_id,'host')
    on conflict(connected_account_id,livemode,refund_id,audience) do nothing;
  return new;
end $$;
revoke all on function parkshare_private.queue_refund_emails() from public,anon,authenticated;
grant execute on function parkshare_private.queue_refund_emails() to service_role;
create trigger queue_verified_refund_emails after insert or update of status
  on public.payment_refunds for each row execute function parkshare_private.queue_refund_emails();
comment on table public.refund_email_deliveries is
  'Service-only refund notifications, one Driver and Host receipt per successful verified refund. Frozen payloads and provider IDs support safe retries.';
commit;
