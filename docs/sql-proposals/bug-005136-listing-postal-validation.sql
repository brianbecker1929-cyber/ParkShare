-- BUG-005136: OPTIONAL DATABASE SAFEGUARD — REVIEW ONLY.
-- Do NOT execute on production or active BetterQA QA.
--
-- Today listings.address is a single free-form text field, not a separate
-- postal_code column. New Host form output ends with a normalized A1A 1A1.
-- This trigger enforces a syntactically valid Canadian postal-code suffix
-- for NEW listings and actual address changes only. It does NOT geocode or
-- verify an address/postal pair against Canada Post's postal code database.
--
-- Read-only audit (2026-10-18): 8/14 QA and 3/13 production addresses
-- lack a matching Canadian postal-code suffix. Do not rewrite those rows.
-- Existing unrelated UPDATEs (price, availability, photos) remain allowed.
-- Existing address edits require an address with a valid code before save.
--
-- Migration must be reviewed/approved and created with Supabase CLI. This
-- file is a staged proposal, not a numbered migration to execute.

begin;
set local lock_timeout = '5s';

create or replace function public.enforce_listing_postal_format_005136()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  -- An existing historical address should not block a metadata-only edit.
  if TG_OP = 'UPDATE' then
    if NEW.address is not distinct from OLD.address then
      return NEW;
    end if;
  end if;
  if NEW.address is null
     or btrim(NEW.address) !~* '[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$'
  then
    raise exception using
      errcode = '23514',
      message = 'Driveway address must end in a Canadian postal code (A1A 1A1)';
  end if;
  return NEW;
end;
$$;

revoke execute on function public.enforce_listing_postal_format_005136()
  from public, anon, authenticated;

drop trigger if exists listings_postal_format_005136 on public.listings;
create trigger listings_postal_format_005136
before insert or update of address on public.listings
for each row
execute function public.enforce_listing_postal_format_005136();

commit;

-- Rollback if approved:
-- drop trigger if exists listings_postal_format_005136 on public.listings;
-- drop function if exists public.enforce_listing_postal_format_005136();
