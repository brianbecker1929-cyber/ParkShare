-- Recovery QA only: separate pause state preserves the Host's saved schedule.
-- No booking, payment, hold or historical availability rows are rewritten.
begin;
alter table public.listings add column if not exists is_paused boolean not null default false;
create schema if not exists parkshare_private;
create or replace function parkshare_private.reject_paused_listing_hold_005445()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare v_paused boolean;
begin
  -- Serialize hold admission against a Host's pause UPDATE. A hold admitted
  -- before that UPDATE remains valid; no later admission may pass a pause.
  select l.is_paused into v_paused from public.listings l
    where l.id = new.listing_id for share;
  if v_paused is true then
    raise exception using errcode = 'P0063', message = 'This listing is paused and is not accepting new bookings.';
  end if;
  return new;
end;
$$;
revoke all on function parkshare_private.reject_paused_listing_hold_005445() from public, anon, authenticated;
grant execute on function parkshare_private.reject_paused_listing_hold_005445() to service_role;
drop trigger if exists booking_holds_listing_not_paused_005445 on public.booking_holds;
create trigger booking_holds_listing_not_paused_005445
before insert on public.booking_holds for each row
execute function parkshare_private.reject_paused_listing_hold_005445();
commit;
