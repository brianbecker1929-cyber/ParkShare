-- BetterQA BUG-005142 — block Driver accounts from acting as Hosts.
-- QA-only migration; do not apply to the active QA database until a
-- coordinated testing window. Auth user roles are stored server-side in
-- public.profiles, not trusted from browser metadata.
--
-- Policies enforce BOTH ownership and the Host role for INSERT, UPDATE,
-- and DELETE. Applies to direct Supabase REST calls as well as the UI.
-- An existing Driver-owned listing will remain stored but no longer editable
-- through ordinary authenticated credentials; review any legacy data
-- separately before the production rollout.

begin;
set local lock_timeout = '5s';

drop policy if exists "Hosts can insert their own listings" on public.listings;
drop policy if exists "Hosts can update their own listings" on public.listings;
drop policy if exists "Hosts can delete their own listings" on public.listings;

create policy "Hosts can insert their own listings"
on public.listings
for insert to authenticated
with check (
  host_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

create policy "Hosts can update their own listings"
on public.listings
for update to authenticated
using (
  host_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
)
with check (
  host_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

create policy "Hosts can delete their own listings"
on public.listings
for delete to authenticated
using (
  host_id = (select auth.uid())
  and exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid()) and p.role = 'host'
  )
);

commit;
