-- BUG-005137 — VALIDATION PROPOSAL ONLY. DO NOT APPLY to active QA/production.
-- Host hourly listing rates must be >= CAD $1.00 and represent whole cents.
-- Deliberately no $200 ceiling: production has historical listings above $200;
-- a product decision/reconciliation is required before imposing that ceiling.
--
-- Before controlled deployment, check:
-- SELECT count(*), min(price), max(price),
--        count(*) FILTER (WHERE price < 1 OR price <> round(price, 2)) AS invalid
-- FROM public.listings;
--
-- Use numbered Supabase migration only after BetterQA approves a controlled
-- QA release and the existing rows have been reviewed.

begin;
set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.listings'::regclass
      and conname = 'listings_hourly_price_valid_005137'
  ) then
    alter table public.listings
      add constraint listings_hourly_price_valid_005137
      check (price >= 1 and price = round(price, 2))
      not valid;
  end if;
end
$$;

commit;

-- Separate approved step AFTER confirming existing rows comply:
-- alter table public.listings validate constraint listings_hourly_price_valid_005137;
