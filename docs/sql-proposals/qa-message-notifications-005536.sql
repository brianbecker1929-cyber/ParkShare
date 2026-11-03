begin;

-- Only future message inserts enqueue mail; never replay historical chats.
create schema if not exists parkshare_private;
create table public.message_email_deliveries (
  message_id bigint primary key references public.messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  payload jsonb check(payload is null or jsonb_typeof(payload)='object'),
  first_attempt_at timestamptz,
  lease_until timestamptz not null default '-infinity',
  provider_id text,
  sent_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text,
  check((sent_at is null)=(provider_id is null)),
  check((payload is null)=(first_attempt_at is null))
);
create index message_email_pending_idx on public.message_email_deliveries(lease_until,message_id)
  where sent_at is null and blocked_at is null;
alter table public.message_email_deliveries enable row level security;
revoke all on public.message_email_deliveries from public,anon,authenticated;
grant select,insert,update on public.message_email_deliveries to service_role;
create policy message_email_worker on public.message_email_deliveries
  for all to service_role using(true) with check(true);

-- Messages already require the authenticated server endpoint for writes.
-- INVOKER keeps that boundary; this trigger does not elevate client privileges.
create function parkshare_private.queue_message_email() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.recipient_id is not null and new.recipient_id<>new.sender_id then
    insert into public.message_email_deliveries(message_id) values(new.id);
  end if;
  return new;
end;
$$;
revoke all on function parkshare_private.queue_message_email() from public,anon,authenticated;
grant usage on schema parkshare_private to service_role;
grant execute on function parkshare_private.queue_message_email() to service_role;
create trigger queue_new_message_email after insert on public.messages
  for each row execute function parkshare_private.queue_message_email();
commit;
